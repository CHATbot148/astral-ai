# Plan: Voice Call Rebuild + New Chat UI + Astraz Pro Model

This is a big change. Before I touch any files, please approve so I don't burn credits on the wrong thing.

## Prerequisites
- I need a **GEMINI_API_KEY** secret added. I'll prompt for it after you approve.

---

## Task 1 — Replace the entire Voice Call feature

Source: your `Astraz-Voice` repo (Gemini Live API with WebSocket proxy + animated Three.js/Canvas VoiceOrb).

### Backend
- Create new edge function `gemini-live-proxy` (Supabase Edge Function with WebSocket support) that brokers between browser ↔ Gemini Live API using `GEMINI_API_KEY`. Mirrors `server.ts` from your repo (token ephemeral session or direct ws proxy).
- Delete/retire old voice-call backend bits (the existing `text-to-speech`/`speech-to-text` are still used for non-call TTS reading — I'll keep those untouched).

### Frontend
- Replace `src/components/chat/VoiceCall.tsx` end-to-end with the architecture from your repo's `App.tsx` + `useGeminiLive.ts` + `audio-utils.ts` + `soundEffects.ts` + `intent.ts`.
- Replace `src/components/chat/VoiceOrb.tsx` with your repo's 636-line Three.js animated orb (port deps: `three`, `@types/three`, `motion`).
- Keep the existing entry point (`VoiceCall` opened from ChatInput) so nothing else breaks.
- Voice call stays **unlimited for all tiers** (including free).

### Dependencies to add
`@google/genai`, `three`, `@types/three`, `motion` (motion is the new framer-motion; we already have framer-motion — I'll use existing one to avoid duplication unless your code needs `motion/react` specifically).

---

## Task 2 — New WelcomeScreen UI + Astraz Pro model

### UI changes (only `WelcomeScreen.tsx` + small header tweak)
Mobile-first redesign to match your screenshots:
- **Top bar**: left = sidebar toggle (current button), center = **model dropdown** ("Astraz" / "Astraz Pro – Smartest"), right = **Temporary Chat** button (new).
- **Center**: Astraz icon (replaces standalone logo) + time-based greeting ("Good morning, {name}" etc. — already exists).
- **Particle animation**: subtle dotted-halftone particles fading in/out every ~2s above the input area (CSS/canvas, mobile-safe, `pointer-events-none`).
- **Suggestion chips**: convert to **horizontal scroll** row, positioned just above input. Uses `overflow-x-auto` with `touch-action: pan-x` to prevent vertical layout break.
- **Keyboard handling**: use `visualViewport` API so greeting+icon shift up just enough when keyboard opens (no overflow).

### Temporary Chat feature
- New button creates an in-memory only conversation, labeled "Temporary Chat" in sidebar with a distinct ghost icon.
- Cleared on: app leave, refresh, switch chat, new chat, or sign-out.
- Not persisted to DB. Stored in React state only.

### Astraz Pro (Gemini) model
- Add `astraz-pro` model option backed by **`google/gemini-3-flash-preview`** (latest available via Lovable AI gateway) — wait, you said "via Gemini API direct". I'll use **your Gemini API key directly** with `gemini-2.5-pro` (latest stable). Confirm if you want a specific model name.
- New table column `subscriptions.pro_messages_used` + `pro_reset_at` for quota tracking.
- Quotas enforced server-side in `chat` edge function:
  - Free → no access (upsell)
  - Basic → 15 msgs / 8h rolling reset
  - Pro → 25 msgs / 5h rolling reset
  - Ultimate → unlimited
- When quota hit → fallback to Mistral + toast "Astraz Pro limit reached, resets in Xh".
- System prompts and AI modes (custom modes) continue to apply identically to both models.
- Update `UpgradeDialog.tsx` to advertise Astraz Pro per tier.

---

## Files touched (estimate)
**New**: `supabase/functions/gemini-live-proxy/index.ts`, `src/hooks/useGeminiLive.ts`, `src/lib/audio-utils.ts`, `src/lib/soundEffects.ts`, `src/components/chat/ParticleField.tsx`, migration for pro quota columns.
**Rewritten**: `VoiceCall.tsx`, `VoiceOrb.tsx`, `WelcomeScreen.tsx`, `ChatContainer.tsx` (model selector + temp chat state), `Sidebar.tsx` (temp chat label), `UpgradeDialog.tsx`, `chat/index.ts` edge fn (model routing + quota).
**Untouched**: TTS, STT, reminders, payments, connectors, auth.

---

## Questions before I start
1. **Gemini model for Astraz Pro chat**: `gemini-2.5-pro` (smartest, slower) or `gemini-2.5-flash` (fast+smart)? You said "latest Gemini" — I'll use **`gemini-2.5-pro`** unless you say otherwise.
2. **Gemini Live model for calls**: your repo uses `gemini-2.0-flash-exp` typically. Keep that, or use newer `gemini-2.5-flash-preview-native-audio-dialog`?
3. The repo uses Express WebSocket server. Supabase edge functions support WebSockets via Deno — I'll port it. OK?
4. Temporary chat: should the **model selector** be visible in temp chats too? (assuming yes)

Reply with answers or just "go" and I'll use the defaults above.