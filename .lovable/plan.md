

## Scheduled Reminders - Full Implementation

### What This Does

When a user says something like "Remind me to drink water at 3pm" or "Remind me to call mom in 30 minutes", Astraz will:

1. Detect the reminder intent automatically
2. Show a red "Reminder Set" text in the chat (not a normal AI response)
3. Display a toast confirmation
4. At the scheduled time: insert the reminder message into the chat AND send a push notification

### How It Works

```text
User sends message
       |
       v
  Detect reminder intent?
  (client-side regex)
       |
   Yes |         No
       v          v
  Parse time     Normal AI flow
  (absolute/relative)
       |
       v
  Call schedule-notification
  edge function
       |
       v
  Show red "Reminder Set" text
  in chat + toast
       |
       v
  [Later, at scheduled time]
       |
       v
  Cron job (pg_cron) calls
  process-reminders edge function
       |
       v
  - Inserts reminder message into
    the conversation as assistant msg
  - Sends push notification via
    web Push API / service worker
  - Updates status to "sent"
```

### Technical Details

**1. Enhanced Reminder Parsing (ChatContainer.tsx)**
- Expand `parseReminderRequest` to support:
  - Relative: "in 30 minutes", "in 2 hours", "in 1 day"
  - Absolute: "at 3pm", "at 10:30am", "at 15:00"
  - Natural: "tomorrow at 9am", "tonight at 8pm"
- Use the user's timezone (already available via `Intl.DateTimeFormat`) to compute correct UTC times

**2. Red "Reminder Set" Indicator (ChatContainer.tsx + ChatMessage.tsx)**
- When a reminder is detected, instead of calling the AI, add a special message with a marker like `[REMINDER_SET]` 
- In ChatMessage, detect this marker and render red styled text: "Reminder Set" with the scheduled time
- Show a toast: "Reminder set for [time]"

**3. New Edge Function: `process-reminders`**
- A cron-triggered function that runs every minute
- Queries `scheduled_notifications` for rows where `status = 'pending'` and `scheduled_for <= now()`
- For each due reminder:
  - Inserts a message into the `messages` table in the user's conversation (red-styled reminder text)
  - Sends a push notification via Web Push if the user has a subscription stored
  - Updates the notification status to `"sent"`

**4. Push Notification Support**
- Add a `push_subscriptions` table to store user push subscription endpoints
- Update `sw.js` to handle push events and show notifications
- Add subscription logic in `ProfilePopup.tsx` or when notifications are enabled
- When a reminder fires, the `process-reminders` function sends a web push to the user's device

**5. Database Changes**
- Create `push_subscriptions` table: `id`, `user_id`, `endpoint`, `p256dh`, `auth`, `created_at`
- RLS: users can only manage their own subscriptions
- Set up pg_cron job to call `process-reminders` every minute

**6. Chat Function Update (chat/index.ts)**
- Add reminder detection patterns to the system prompt so the AI knows NOT to respond when a reminder is being set
- This is already handled client-side (returns early), so minimal changes needed here

### Files to Create/Modify

| File | Action |
|------|--------|
| `src/components/chat/ChatContainer.tsx` | Enhanced reminder parsing, red "Reminder Set" message, push subscription |
| `src/components/chat/ChatMessage.tsx` | Render `[REMINDER_SET]` marker as red styled text |
| `src/lib/reminderParser.ts` | New - dedicated reminder parsing with absolute/relative time support |
| `supabase/functions/process-reminders/index.ts` | New - cron worker to deliver due reminders |
| `public/sw.js` | Add push notification event handler |
| `supabase/functions/schedule-notification/index.ts` | Minor update to also store push notification data |
| Database migration | `push_subscriptions` table + RLS policies |
| SQL (insert tool) | pg_cron job to trigger process-reminders every minute |

