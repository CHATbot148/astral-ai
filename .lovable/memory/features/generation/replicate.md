---
name: Replicate generation
description: Replicate edge function (replicate-generate) handles FLUX Schnell/1.1 Pro, SDXL, Ideogram v2 images and Wan 2.2 i2v-fast video via Lovable connector gateway
type: feature
---
- Edge function: `supabase/functions/replicate-generate/index.ts`
- Gateway URL: `https://connector-gateway.lovable.dev/replicate/v1`
- Headers: `Authorization: Bearer ${LOVABLE_API_KEY}` + `X-Connection-Api-Key: ${REPLICATE_API_KEY}`
- Image model IDs: `flux_schnell`, `flux_pro`, `sdxl`, `ideogram_v2`
- Video model IDs: `wan_22_fast` (requires `imageUrl` — image-to-video only)
- Dispatch lives in `src/components/chat/ChatContainer.tsx` — `generateImageOnly` and `handleVideoGenerate` route to `replicate-generate` when modelId matches the Replicate set; otherwise hits existing `generate-image` / `generate-video`.
- Output is uploaded to `chat-files` bucket and returned as `storage:chat-files/<path>` ref.
