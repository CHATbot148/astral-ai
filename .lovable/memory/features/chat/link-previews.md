---
name: Firecrawl link previews
description: Auto-generates rich preview cards for URLs in chat messages via Firecrawl scrape (summary + screenshot)
type: feature
---
- Edge function: `supabase/functions/link-preview/index.ts` — POST `{ url }`, returns `{ url, title, description, image, site, favicon }`.
- Calls Firecrawl v2 `/scrape` with `formats: ["summary","screenshot"]`, 6h in-memory cache.
- UI: `src/components/chat/LinkPreview.tsx` (component + `extractPreviewableUrls` helper).
- ChatMessage renders previews under the message for first 2 URLs; skips image/video/storage URLs (those render as native media).
