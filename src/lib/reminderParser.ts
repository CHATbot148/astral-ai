/**
 * Parses natural-language reminder requests and returns the reminder message
 * and an ISO-8601 timestamp for when it should fire.
 */

const TRIGGER_RE =
  /(?:remind me|set a reminder|notify me|message me|alert me|wake me up)(?:\s+(?:to|about|for|that))?\s+(.+)/i;

/** Relative: "in 30 minutes", "in 2 hours", "in 1 day" */
const RELATIVE_RE = /\b(?:in|after)\s+(\d+)\s+(seconds?|minutes?|mins?|hours?|hrs?|days?)\b/i;

/** Absolute: "at 3pm", "at 15:00", "at 10:30am" */
const ABSOLUTE_RE = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

/** Tomorrow qualifier */
const TOMORROW_RE = /\btomorrow\b/i;

/** Tonight qualifier */
const TONIGHT_RE = /\btonight\b/i;

export interface ParsedReminder {
  /** The reminder content the user wants to be reminded about */
  message: string;
  /** ISO-8601 UTC timestamp for when the reminder should fire */
  scheduledForISO: string;
  /** Human-readable local time string for UI display */
  displayTime: string;
}

/**
 * Returns null if the text isn't a reminder request.
 */
export function parseReminderRequest(text: string): ParsedReminder | null {
  const trigger = text.match(TRIGGER_RE);
  if (!trigger) return null;

  const body = trigger[1].trim();

  // Try relative first
  const rel = body.match(RELATIVE_RE);
  if (rel) {
    const amount = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) return null;

    let ms = 0;
    if (unit.startsWith('sec')) ms = amount * 1_000;
    else if (unit.startsWith('min')) ms = amount * 60_000;
    else if (unit.startsWith('hr') || unit.startsWith('hour')) ms = amount * 3_600_000;
    else if (unit.startsWith('day')) ms = amount * 86_400_000;

    const fireAt = new Date(Date.now() + ms);
    const message = body.replace(RELATIVE_RE, '').replace(/\s{2,}/g, ' ').trim();
    if (!message) return null;

    return {
      message,
      scheduledForISO: fireAt.toISOString(),
      displayTime: fireAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
  }

  // Try absolute
  const abs = body.match(ABSOLUTE_RE);
  if (abs) {
    let hour = Number(abs[1]);
    const minute = abs[2] ? Number(abs[2]) : 0;
    const meridiem = abs[3]?.toLowerCase();

    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    // If no meridiem and hour <= 6, assume PM (common conversational pattern)
    if (!meridiem && hour >= 1 && hour <= 6) hour += 12;

    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);

    // If "tomorrow" is mentioned, always use tomorrow
    if (TOMORROW_RE.test(body)) {
      target.setDate(target.getDate() + 1);
    } else if (TONIGHT_RE.test(body)) {
      // tonight: if the time has passed, keep today (tonight at 8pm when it's 3pm is fine)
      if (target <= now) target.setDate(target.getDate() + 1);
    } else {
      // Default: if the time has already passed today, schedule for tomorrow
      if (target <= now) target.setDate(target.getDate() + 1);
    }

    const message = body
      .replace(ABSOLUTE_RE, '')
      .replace(TOMORROW_RE, '')
      .replace(TONIGHT_RE, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!message) return null;

    return {
      message,
      scheduledForISO: target.toISOString(),
      displayTime: target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
  }

  return null;
}
