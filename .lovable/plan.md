## 1. Fix the visualization container (image annotation)

The big empty black box around the small "How Data Travels" card is the fixed-height iframe surrounding the actual widget. Fix:

- Make the iframe auto-size to its content (inject a tiny script into `srcDoc` that uses `ResizeObserver` on `document.body` and `postMessage`s height to the parent; parent listens and sets `iframe.style.height`).
- Drop the fixed `h-[460px]` baseline; use a small min-height (e.g. 140px) so it grows to fit only what the widget renders.
- Make the iframe wrapper background transparent and attach the toolbar directly to the top of the visible widget (no rounded bottom card gap, no border around empty space).
- Result: only the toolbar + the actual widget card are visible — no big outer black container.

Files: `src/components/chat/VizBlock.tsx`.

## 2. Full Chat UI overhaul (Midnight Indigo + Space Grotesk/DM Sans)

Scope: the existing chat surface only (ChatContainer, ChatHeader, ChatInput, ChatMessage, Sidebar, WelcomeScreen, TypingIndicator). Not the "New Chat" creation flow.

Design system updates:
- Install `@fontsource/space-grotesk` and `@fontsource/dm-sans`, import in `src/main.tsx`, wire `font-display` (Space Grotesk) and `font-sans` (DM Sans) into `tailwind.config.ts`.
- Add new Midnight Indigo tokens to `index.css`:
  - `--bg-base: #0a0a1a`, `--bg-surface: #141432`, `--bg-elevated: #1e1e5a`, `--accent: #4f46e5` (indigo-600), `--accent-glow: #818cf8`.
  - New gradient tokens: `--gradient-midnight` (radial mesh of indigo + violet), `--gradient-accent` (#4f46e5 → #818cf8), `--shadow-indigo-glow`.
- Replace current `aurora-bg` usage on chat pages with a richer animated mesh background (CSS keyframes drifting two radial gradients over `--bg-base`).

Components refreshed (visual only, no logic changes):
- **ChatContainer**: animated mesh background, soft vignette, subtle grain overlay; scroll area gets fade-mask at top/bottom.
- **ChatHeader**: glass pill with indigo border-glow, restyled model selector with smoother dropdown spring animation.
- **ChatInput**: floating glass composer with indigo focus-ring glow, animated mic/send buttons (scale + glow), attachment chip animations, send button using new gradient.
- **ChatMessage**: assistant bubbles transparent on background (per spec); user bubbles use indigo `--accent` with white text; markdown typography swapped to DM Sans with Space Grotesk for headings; code blocks use new indigo accent border; entry animation upgraded (slide+fade+scale, staggered).
- **Sidebar**: indigo accent highlights, hover lift, smoother slide-in spring.
- **WelcomeScreen / TypingIndicator**: new pulse/shimmer using accent tokens.

New animation utilities added to `tailwind.config.ts`:
- `mesh-drift` (20s background motion), `glow-pulse`, `slide-up-fade`, `pop-in`, `shimmer-indigo`.

Files: `src/index.css`, `tailwind.config.ts`, `src/main.tsx`, `package.json`, and the chat components listed above.

## 3. Real long-term user memory system (ChatGPT/Claude-style)

Currently Astraz only saves basics. Upgrade to a proper categorized memory store with automatic extraction, deduplication, and recall.

### Schema (migration)

Replace ad-hoc storage with a structured `user_memory` table (or extend existing):

```text
user_memory
  id uuid pk
  user_id uuid (auth.uid, RLS)
  category text  -- 'preference' | 'long_term' | 'relationship' | 'fact' | 'rule'
  key text       -- short slug, e.g. 'communication_style'
  value text     -- the actual memory content
  importance int -- 1..5
  source_message_id uuid null
  created_at, updated_at, last_used_at
  unique (user_id, category, key)
```

GRANT + RLS for `authenticated`.

### Extraction pipeline (edge function)

In `supabase/functions/chat/index.ts`:
- After each user turn (or batched every N turns), call a lightweight Mistral pass with a strict JSON-schema prompt to extract memory candidates across all four categories.
- Upsert by `(user_id, category, key)`; merge/update if key already exists (avoids duplicates).
- Track `last_used_at` whenever a memory is injected into a future prompt.

### Recall pipeline

- On every chat request, fetch top ~30 memories ordered by `importance DESC, last_used_at DESC` for that `user_id`.
- Inject them as a structured `### Known about user` block into the system prompt grouped by category.
- Respect existing privacy rule: JWT-derived `user_id` only, never trusted from client.

### UI (Profile → Memory page)

- List memories grouped by category with edit/delete.
- "Clear all memories" action (already aligned with privacy memory rule: explicit deletion required).

### Files

- New migration: `supabase/migrations/<ts>_user_memory_upgrade.sql`.
- `supabase/functions/chat/index.ts` (extraction + recall).
- New `supabase/functions/extract-memory/index.ts` if extraction is moved off the hot path.
- New `src/pages/MemorySettings.tsx` + link from `ProfilePopup`.

## Out of scope

- Voice call connection (already fixed last turn).
- New Chat creation UI (user excluded it).
- Payments, connectors, auth flows.

## Technical notes

- Iframe auto-resize uses `postMessage({ type: 'astraz-viz-height', height })` with origin check `event.source === iframe.contentWindow`.
- Memory extraction prompt enforces JSON schema; on parse failure, skip silently (no toasts per project rule).
- Recall injection is capped at ~2KB of memory text to protect Mistral context.
