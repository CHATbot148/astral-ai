## 1. Astraz Pro model upgrade (Puter.js)

Change the Pro path in `supabase/functions/chat/index.ts`:

- **Primary**: `openai/gpt-5.5` via Puter.js chat SSE (unlimited free tier).
- **Fallback**: `anthropic/claude-opus-4-8` — invoked when GPT-5.5 returns a hard error, times out (>25s to first token), or the stream aborts before any text.
- Keep the existing custom SSE wrapper so the frontend stays untouched.
- Log which model actually served the turn (server-side only) for triage.

## 2. Fix the "rigid" feel — subtle motion pass

Approach: use short (150–200 ms) fades/slides/scales via `framer-motion` where components mount/unmount, and Tailwind transitions on interactive elements. Nothing over 200 ms so latency-sensitive interactions still feel snappy. All animations respect `prefers-reduced-motion`.

### 2a. Sending a message
`src/components/chat/ChatContainer.tsx` + `ChatMessage.tsx`:
- Wrap each new message in a `motion.div` with `initial={{opacity:0, y:8}}`, `animate={{opacity:1, y:0}}`, `transition={{duration:0.18, ease:"easeOut"}}`.
- On send: brief scale-tap on the send button (`active:scale-95`) and a soft fade-slide entrance for the user bubble — no more "pop in".
- Keep streamed assistant text as-is (no per-char animation — that's what caused the Pro lag before).

### 2b. Button taps (global)
Add a lightweight `.tap` utility class in `src/index.css`:
```css
.tap { @apply transition-transform duration-150 ease-out active:scale-[0.96]; }
```
Apply to: send button, plus/attachment button, sidebar toggle, header buttons, profile buttons, image-dialog buttons, model switcher, scroll-to-bottom button. Also add `transition-colors duration-150` to hover states that currently jump.

### 2c. Sidebar / popups
- `Sidebar.tsx`: swap the current abrupt open/close for framer-motion `x: -100% → 0` slide with `duration: 0.2, ease: [0.22, 1, 0.36, 1]` (already partially there — normalize timings).
- `ProfilePopup.tsx`, `MemoryPopup.tsx`, `UpgradeDialog.tsx`, `ImageGenerateDialog.tsx`: wrap contents in a `motion.div` with `scale: 0.98 → 1` + `opacity` (180 ms).
- Sidebar backdrop: fade 150 ms instead of instant.

### 2d. Route / page transitions
`src/App.tsx`: wrap `<Routes>` in `AnimatePresence mode="wait"` and give each page a `motion.div` with a 150 ms fade. Keeps things fast, kills the hard cut between `/auth` → `/` and settings navigations.

### 2e. Typing indicator + streaming
- `TypingIndicator.tsx`: already animated — just soften the shimmer speed (`1.8s → 1.4s`) so it feels more alive.
- `ChatInput.tsx`: on submit, the input clears with a 120 ms opacity fade rather than instant clear.

### 2f. New-chat / welcome
`WelcomeScreen.tsx`: stagger-fade suggestion chips (40 ms stagger, 200 ms each).

## 3. Reduced-motion + perf guardrails

- All framer-motion wrappers read `useReducedMotion()` and become no-ops when the OS setting is on.
- No animations added to streaming text, media rendering, or list virtualization paths — avoids the Pro lag issue we already fixed.
- No layout-thrashing animations (only `transform` + `opacity`).

## Technical notes

**Files touched (frontend):**
- `src/App.tsx` — route transitions
- `src/index.css` — `.tap` utility + reduced-motion helpers
- `src/components/chat/ChatContainer.tsx` — message enter animation
- `src/components/chat/ChatMessage.tsx` — bubble mount animation
- `src/components/chat/ChatInput.tsx` — send button tap + input clear fade
- `src/components/chat/Sidebar.tsx` — normalized slide timings
- `src/components/chat/ChatHeader.tsx` — tap class on buttons
- `src/components/chat/TypingIndicator.tsx` — shimmer tuning
- `src/components/chat/WelcomeScreen.tsx` — staggered suggestions
- `src/components/profile/ProfilePopup.tsx`, `MemoryPopup.tsx` — modal enter
- `src/components/subscription/UpgradeDialog.tsx` — modal enter
- `src/components/chat/ImageGenerateDialog.tsx` — button tap class (motion already present)

**Files touched (backend):**
- `supabase/functions/chat/index.ts` — swap Pro primary to `openai/gpt-5.5`, add Opus 4.8 fallback with timeout + stream-abort detection.

**Not touched:**
- Image/video generation, subscriptions, auth flows, email pipeline — out of scope.
- No changes to typing/streaming logic that would reintroduce sync issues.

## Out of scope (won't do this pass)
- Redesigning any screens.
- Changing the default Astraz (Mistral) model.
- Touching the sound/haptics stack.
