/**
 * Parses natural-language reminder requests and returns the reminder message
 * and an ISO-8601 timestamp for when it should fire.
 */

const TRIGGER_RE =
  /(?:remind me|set a reminder|notify me|message me|alert me|wake me up)(?:\s+(?:to|about|for|that))?\s+(.+)/i;

/** Also match "remind me at 6pm to ..." where the time comes right after trigger */
const TRIGGER_TIME_FIRST_RE =
  /(?:remind me|set a reminder|notify me|message me|alert me|wake me up)\s+(?:at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)\s+(?:to|about|for|that)\s+(.+)/i;

/** Relative: "in 30 minutes", "in 2 hours", "in one day" */
const RELATIVE_RE = /\b(?:in|after)\s+(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(seconds?|minutes?|mins?|hours?|hrs?|days?)\b/i;

/** Absolute: "at 3pm", "at 15:00", "at 10:30am", or standalone "6pm", "6:30pm" */
const ABSOLUTE_RE = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

/** Standalone time without "at": "6pm", "6:30pm", "18:00" - used as fallback */
const STANDALONE_TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;

/** Tomorrow qualifier */
const TOMORROW_RE = /\btomorrow\b/i;

/** Tonight qualifier */
const TONIGHT_RE = /\btonight\b/i;

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

export interface ParsedReminder {
  /** The reminder content the user wants to be reminded about */
  message: string;
  /** ISO-8601 UTC timestamp for when the reminder should fire */
  scheduledForISO: string;
  /** Human-readable local time string for UI display */
  displayTime: string;
}

function buildTargetDate(hour: number, minute: number, meridiem: string | undefined, body: string): Date {
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  // If no meridiem and hour <= 6, assume PM (common conversational pattern)
  if (!meridiem && hour >= 1 && hour <= 6) hour += 12;

  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);

  if (TOMORROW_RE.test(body)) {
    target.setDate(target.getDate() + 1);
  } else if (TONIGHT_RE.test(body)) {
    if (target <= now) target.setDate(target.getDate() + 1);
  } else {
    if (target <= now) target.setDate(target.getDate() + 1);
  }

  return target;
}

function cleanMessage(body: string, ...patterns: RegExp[]): string {
  let msg = body;
  for (const p of patterns) {
    msg = msg.replace(p, '');
  }
  return msg.replace(TOMORROW_RE, '').replace(TONIGHT_RE, '').replace(/\s{2,}/g, ' ').trim();
}

function parseAmount(rawAmount: string): number {
  const normalized = rawAmount.trim().toLowerCase();
  const asNumber = Number(normalized);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
  return NUMBER_WORDS[normalized] ?? NaN;
}

/**
 * Returns null if the text isn't a reminder request.
 */
export function parseReminderRequest(text: string): ParsedReminder | null {
  // Try "remind me at 6pm to drink water" pattern first
  const timeFirst = text.match(TRIGGER_TIME_FIRST_RE);
  if (timeFirst) {
    const hour = Number(timeFirst[1]);
    const minute = timeFirst[2] ? Number(timeFirst[2]) : 0;
    const meridiem = timeFirst[3]?.toLowerCase();
    const message = timeFirst[4].trim();
    if (!message) return null;

    const target = buildTargetDate(hour, minute, meridiem, text);
    return {
      message,
      scheduledForISO: target.toISOString(),
      displayTime: target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
  }

  const trigger = text.match(TRIGGER_RE);
  if (!trigger) return null;

  const body = trigger[1].trim();

  // Try relative first
  const rel = body.match(RELATIVE_RE);
  if (rel) {
    const amount = parseAmount(rel[1]);
    const unit = rel[2].toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) return null;

    let ms = 0;
    if (unit.startsWith('sec')) ms = amount * 1_000;
    else if (unit.startsWith('min')) ms = amount * 60_000;
    else if (unit.startsWith('hr') || unit.startsWith('hour')) ms = amount * 3_600_000;
    else if (unit.startsWith('day')) ms = amount * 86_400_000;

    const fireAt = new Date(Date.now() + ms);
    const message = cleanMessage(body, RELATIVE_RE);
    if (!message) return null;

    return {
      message,
      scheduledForISO: fireAt.toISOString(),
      displayTime: fireAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
  }

  // Try absolute with "at"
  const abs = body.match(ABSOLUTE_RE);
  if (abs) {
    const hour = Number(abs[1]);
    const minute = abs[2] ? Number(abs[2]) : 0;
    const meridiem = abs[3]?.toLowerCase();

    const target = buildTargetDate(hour, minute, meridiem, body);
    const message = cleanMessage(body, ABSOLUTE_RE);
    
    // If no message extracted, use the original body without the time as a fallback
    if (!message) {
      // Try to get message from original text
      const fallbackMsg = text.replace(TRIGGER_RE, '').trim() || 'Reminder';
      return {
        message: fallbackMsg || 'Reminder',
        scheduledForISO: target.toISOString(),
        displayTime: target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
    }

    return {
      message,
      scheduledForISO: target.toISOString(),
      displayTime: target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
  }

  // Try standalone time without "at" (e.g., "remind me to drink water 6pm")
  const standalone = body.match(STANDALONE_TIME_RE);
  if (standalone) {
    const hour = Number(standalone[1]);
    const minute = standalone[2] ? Number(standalone[2]) : 0;
    const meridiem = standalone[3]?.toLowerCase();

    const target = buildTargetDate(hour, minute, meridiem, body);
    const message = cleanMessage(body, STANDALONE_TIME_RE);
    if (!message) return null;

    return {
      message,
      scheduledForISO: target.toISOString(),
      displayTime: target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
  }

  return null;
}
