# Mega-fix plan

Doing all four workstreams in this single batch. No partial drops.

## 1. Attachments + media popups (highest priority)

**Pill-style attachment chip** (replaces current ugly preview)
- New `AttachmentChip.tsx`: rectangular pill, ~280px max wide. Left = type icon (image/video/audio/PDF/doc) with colored gradient square. Right = filename truncated to 10 chars + extension (`Quarterl…pdf`), file size below. For images/videos, swap the icon square for a real thumbnail. Used in ChatInput preview and in sent ChatMessage attachments.
- Astraz actually reading files: in `ChatInput.tsx`, upload files to `chat-files` bucket and send their public URL + filename to `chat` function in a new `attachments` array. In `supabase/functions/chat/index.ts`, accept `attachments[]`. For images, pass directly to the vision-capable model. For PDFs/docs, fetch the URL server-side, extract text via a lightweight parser (pdf for PDF, plain decode for text/csv/json/md), inject as system context. Tell user when format is unsupported.

**Dedicated MediaViewer modal** (`MediaViewer.tsx`) — replaces ImagePreviewModal entirely. Routes by media type:
- **Video / AI-generated video**: full HTML5 `<video controls>`, dark backdrop, top bar with close + Download. Blob-fetch download for cross-origin.
- **User image attachment**: image canvas with overlay drawing tool — user can free-draw circles/arrows; on "Send to Astraz" the annotated image is sent back into chat with prompt "I'm referring to the circled area".
- **AI-generated image**: Download + Edit buttons. Edit opens brush-mask overlay with adjustable brush size, opacity, undo, clear. Prompt input + optional reference upload. Submits to existing `generate-image` edge function with mask + prompt (Leonardo inpainting).
- **Document (PDF)**: render via `<iframe src={url}>` or react-pdf for multi-page scroll; native PDF viewer is fine fallback. Top bar with Download.
- **Generic file**: just download.

## 2. Visualization rework

Rebuild `VizBlock.tsx` as a **big rich preview card** (not a tiny "Open" button):
- Card with gradient header showing viz title (extracted from HTML `<title>` or first heading), dim screenshot-style placeholder (rendered from a hidden iframe captured to canvas, or a static "Interactive Visualization" mesh-gradient art), "Interactive" badge.
- Single tap = expand inline to full-width interactive iframe with floating control bar (restart, fullscreen, copy code). No "Show me the visualization" gate text.
- Better iframe defaults: `allow-scripts allow-same-origin allow-pointer-lock`, responsive height (min 400, max 600 normal / 100vh fullscreen).

## 3. Models + Call quality

- **Astraz Pro chat model**: in `supabase/functions/chat/index.ts`, swap pro path from current Gemini to `google/gemini-3.1-pro-preview` (top-tier reasoning).
- **Voice Call**: in `supabase/functions/gemini-live-proxy/index.ts`, swap model from `gemini-3.1-flash-live-preview` to `gemini-3.1-pro-live-preview` (or latest live-preview pro variant; falls back to flash if pro unavailable).
- **Call audio breakup**: in `useGeminiLive.ts` add (a) PCM jitter buffer that queues incoming audio chunks and plays them with a 120ms lead-in, (b) larger send chunk size (40ms → 100ms) to reduce packet rate, (c) auto-reconnect on `onclose` with exponential backoff if call still active, (d) WS keepalive ping every 15s.

## 4. Security fixes (non-breaking only)

SQL migration:
- `daily_usage`: drop user INSERT/UPDATE policies; only service role writes (edge functions already use service role for usage counts).
- `subscriptions`: drop user INSERT/UPDATE; service role only (paystack-verify already uses service role).
- `promo_codes`: tighten SELECT to authenticated only AND remove `code` column from selectable (create `promo_codes_public` view with id/tier/description but no code; redeem uses RPC which already row-locks).
- `realtime.messages`: add RLS policy scoping channels by `conversation_id` ownership.
- `push_subscriptions`: revoke client SELECT (only service-role read for send-push).
- `user_connections`: drop client SELECT on `oauth_tokens` via a public view that omits the column.
- `scheduled_notifications`: restrict UPDATE to non-status columns via column grants.
- `has_role`/`redeem_promo_code` SECURITY DEFINER: keep but `REVOKE EXECUTE FROM anon, authenticated` where not needed; redeem stays callable by authenticated.
- `chat-files` bucket: keep public read for object URLs but remove broad list policy (add SELECT policy WHERE name LIKE auth.uid()||'/%' for listing).

Skip if it'd break: anything that breaks existing edge functions' service-role writes is fine since they bypass RLS.

## 5. Typewriter greeting

In `WelcomeScreen.tsx`, animate the greeting + name with a 35ms-per-char typewriter (custom hook `useTypewriter`). Only on fresh sessions (no animation when re-entering a thread). Cursor blink while typing.

---

## Files touched
- New: `src/components/chat/AttachmentChip.tsx`, `src/components/chat/MediaViewer.tsx`, `src/components/chat/ImageAnnotator.tsx`, `src/components/chat/ImageMaskEditor.tsx`, `src/components/chat/DocumentViewer.tsx`, `src/hooks/useTypewriter.ts`
- Edited: `ChatInput.tsx`, `ChatMessage.tsx`, `ChatContainer.tsx`, `MediaRenderer.tsx`, `VizBlock.tsx`, `WelcomeScreen.tsx`, `useGeminiLive.ts`, `supabase/functions/chat/index.ts`, `supabase/functions/gemini-live-proxy/index.ts`, `supabase/functions/generate-image/index.ts` (mask support)
- Deleted: `ImagePreviewModal.tsx`
- 1 SQL migration for security fixes

## Order of execution
1. Security migration (independent, fast)
2. Edge function model swaps + call quality
3. Attachment chip + file upload pipeline
4. MediaViewer with all four routes
5. Viz rework
6. Typewriter greeting
7. Verify build

Confirm and I'll ship.