import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STYLE_PROMPTS: Record<string, string> = {
  photoreal: "ultra realistic professional photograph, natural lens rendering, real materials, tactile surface detail, accurate reflections, high-end commercial photography",
  cinematic: "cinematic shot, motivated practical lighting, realistic production design, filmic color grade, subtle film grain, premium movie-still composition",
  anime: "high-detail anime illustration, strong composition, expressive lighting, clean linework, vibrant but controlled colors",
  sketch: "pencil sketch, hand drawn, detailed line art, artistic illustration",
  none: "",
};

const CEO_EMAIL = "khaleelktn@gmail.com";

const ASPECT_RATIO_MAP: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1344, height: 768 },
  "9:16": { width: 768, height: 1344 },
  "3:2": { width: 1152, height: 768 },
  "4:3": { width: 1152, height: 896 },
  "3:4": { width: 896, height: 1152 },
};

const ASPECT_LABELS: Record<string, string> = {
  "1:1": "square 1:1",
  "16:9": "wide landscape 16:9",
  "9:16": "vertical portrait 9:16",
  "4:3": "classic landscape 4:3",
  "3:2": "professional camera 3:2",
};

// Provider model mapping
const IMAGE_MODELS: Record<
  string,
  {
    provider: "lovable" | "leonardo" | "pollinations" | "huggingface";
    lovableModel?: string;
    leonardoId?: string;
    pollinationsModel?: string;
    huggingFaceProviderId?: string;
    huggingFaceModel?: string;
  }
> = {
  pollinations_gpt_image_2: { provider: "pollinations", pollinationsModel: "gpt-image-2" },
  pollinations_nanobanana_pro: { provider: "pollinations", pollinationsModel: "nanobanana-pro" },
  pollinations_seedream5: { provider: "pollinations", pollinationsModel: "seedream5" },
  pollinations_ideogram_quality: { provider: "pollinations", pollinationsModel: "ideogram-v4-quality" },
  hf_ideogram_4: { provider: "huggingface", huggingFaceProviderId: "ideogram/v4", huggingFaceModel: "ideogram-ai/ideogram-4-fp8" },
  hf_flux_krea: { provider: "huggingface", huggingFaceProviderId: "fal-ai/flux/krea", huggingFaceModel: "black-forest-labs/FLUX.1-Krea-dev" },
  hf_qwen_image: { provider: "huggingface", huggingFaceProviderId: "fal-ai/qwen-image", huggingFaceModel: "Qwen/Qwen-Image" },
  nano_banana: { provider: "lovable", lovableModel: "google/gemini-2.5-flash-image" },
  nano_banana_2: { provider: "lovable", lovableModel: "google/gemini-3.1-flash-image" },
  seedream_4_5: { provider: "leonardo", leonardoId: "b24e16ff-06e3-43eb-8d33-4c419f36e1b7" },
  lucid_origin: { provider: "leonardo", leonardoId: "5c232a9e-9061-4777-980a-ddc8e65647c6" },
  flux_2_pro: { provider: "leonardo", leonardoId: "aa77f04e-3eec-4034-9c07-d0f619684628" },
  phoenix: { provider: "leonardo", leonardoId: "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3" },
};

const DEFAULT_MODEL = "pollinations_gpt_image_2";
const VIDEO_REFERENCE_PATTERN = /\.(mp4|webm|mov|avi|mkv|m4v|gif)(\?|$)/i;

const isLikelyVideoReference = (ref: string) => ref.startsWith("data:video/") || VIDEO_REFERENCE_PATTERN.test(ref);

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime: match[1], bytes };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function compactPromptForUrl(prompt: string, max = 1800): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

function isQuotaOrCreditError(errorText: string, status?: number): boolean {
  return status === 402 || status === 429 || /quota|rate.?limit|resource_exhausted|not enough credits|payment_required/i.test(errorText);
}

async function downloadImageFromUrl(url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const imgRes = await fetch(url);
  if (!imgRes.ok) return null;
  const mime = imgRes.headers.get("content-type") || "image/png";
  if (!mime.startsWith("image/")) return null;
  return { bytes: new Uint8Array(await imgRes.arrayBuffer()), mime };
}

async function uploadAndSave(
  admin: any,
  userId: string,
  prompt: string,
  style: string,
  aspectRatio: string,
  imgBytes: Uint8Array,
  mime: string
) {
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const path = `${userId}/generated/img-${Date.now()}.${ext}`;
  const { error } = await admin.storage
    .from("chat-files")
    .upload(path, imgBytes, { contentType: mime, upsert: false });
  if (error) throw error;

  const ref = `storage:chat-files/${path}`;
  if (userId !== "anonymous") {
    await admin.from("generated_images").insert({
      user_id: userId,
      prompt,
      image_url: ref,
      style,
      aspect_ratio: aspectRatio,
    });
  }
  return ref;
}

async function getDailyImageUsage(admin: any, userId: string, usageDate: string): Promise<number> {
  const { data, error } = await admin
    .from("daily_usage")
    .select("images_generated")
    .eq("user_id", userId)
    .eq("usage_date", usageDate)
    .maybeSingle();
  if (error) {
    console.error("Failed to read image usage:", error);
    return 0;
  }
  return Number(data?.images_generated || 0);
}

async function incrementDailyImageUsage(admin: any, userId: string, usageDate: string) {
  const { data: existing, error } = await admin
    .from("daily_usage")
    .select("id, images_generated, videos_generated")
    .eq("user_id", userId)
    .eq("usage_date", usageDate)
    .maybeSingle();

  if (error) {
    console.error("Failed to read image usage for increment:", error);
    return;
  }

  if (existing?.id) {
    const nextImages = Number(existing.images_generated || 0) + 1;
    const { error: updateError } = await admin
      .from("daily_usage")
      .update({ images_generated: nextImages, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updateError) console.error("Failed to update image usage:", updateError);
    return;
  }

  const { error: insertError } = await admin
    .from("daily_usage")
    .insert({ user_id: userId, usage_date: usageDate, images_generated: 1, videos_generated: 0 });
  if (insertError) console.error("Failed to insert image usage:", insertError);
}

async function resolveStorageRefToSignedUrl(storageRef: string): Promise<string> {
  // Expects storage:bucket/path
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return storageRef;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const raw = storageRef.slice("storage:".length);
  const slashIdx = raw.indexOf("/");
  const bucket = raw.slice(0, slashIdx);
  const path = raw.slice(slashIdx + 1);
  const { data: signed } = await admin.storage.from(bucket).createSignedUrl(path, 60 * 60);
  return signed?.signedUrl || storageRef;
}

async function resolveReferenceImageToBytes(referenceImageUrl: string): Promise<{ bytes: Uint8Array; mime: string }> {
  if (referenceImageUrl.startsWith("data:")) {
    return parseDataUrl(referenceImageUrl);
  }

  let url = referenceImageUrl;
  if (referenceImageUrl.startsWith("storage:")) {
    url = await resolveStorageRefToSignedUrl(referenceImageUrl);
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download reference media (${res.status})`);
  const mime = res.headers.get("content-type") || (isLikelyVideoReference(referenceImageUrl) ? "video/mp4" : "image/jpeg");
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, mime };
}

async function geminiUploadResumable(
  geminiKey: string,
  bytes: ArrayBuffer,
  contentType: string
): Promise<{ fileUri: string; mimeType: string; fileName: string }> {
  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${geminiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
        "X-Goog-Upload-Header-Content-Type": contentType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: "reference-media" } }),
    }
  );

  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    const t = await startRes.text().catch(() => "");
    throw new Error(`Gemini Files API start failed (${startRes.status}): ${t}`);
  }

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
  });

  const info = await uploadRes.json();
  const fileUri = info?.file?.uri;
  const fileName = info?.file?.name;
  if (!fileUri || !fileName) {
    throw new Error("Gemini Files API upload failed: missing file URI");
  }

  let state = info?.file?.state;
  let attempts = 0;
  while (state === "PROCESSING" && attempts < 30) {
    await new Promise((r) => setTimeout(r, 2000));
    const checkRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${geminiKey}`);
    const checkData = await checkRes.json();
    state = checkData.state;
    attempts++;
  }

  if (state !== "ACTIVE") {
    throw new Error(`Reference media processing failed (${state || "unknown"})`);
  }

  return { fileUri, mimeType: contentType, fileName };
}

async function describeVideoReferenceForImagePrompt(
  userInstruction: string,
  referenceMediaUrl: string
): Promise<string | null> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) return null;

  const { bytes, mime } = await resolveReferenceImageToBytes(referenceMediaUrl);
  if (!(mime.startsWith("video/") || mime === "image/gif")) return null;

  const uploaded = await geminiUploadResumable(GEMINI_API_KEY, bytes.buffer, mime);
  const instruction =
    "Describe this reference media for image generation. " +
    "Return a concise visual brief with subject, composition, style, colors, lighting, and mood. " +
    "No extra guesses.";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ fileData: { mimeType: uploaded.mimeType, fileUri: uploaded.fileUri } }, { text: instruction }] }],
        generationConfig: { maxOutputTokens: 384, temperature: 0.2 },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini video reference analysis failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  return `Use this reference-media visual brief while following the prompt "${userInstruction}": ${String(text).trim()}`;
}

async function generateWithLovable(
  prompt: string,
  model: string,
  referenceImageUrl?: string
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;

  // Build message content - support image-to-image via multimodal input
  let messageContent: any;
  if (referenceImageUrl) {
    // Resolve reference image to a usable URL
    let imageUrl = referenceImageUrl;
    if (referenceImageUrl.startsWith("storage:")) {
      try {
        imageUrl = await resolveStorageRefToSignedUrl(referenceImageUrl);
      } catch {
        // non-blocking
      }
    }

    messageContent = [
      { type: "text", text: `Using the attached image as a reference, create a variation: ${prompt}` },
      { type: "image_url", image_url: { url: imageUrl } },
    ];
  } else {
    messageContent = prompt;
  }

  const response = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: {
      "Lovable-API-Key": LOVABLE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: messageContent }],
      modalities: ["image", "text"],
      stream: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Lovable AI image generation failed:", response.status, errText);
    return null;
  }

  const data = await response.json();
  const b64 = data?.data?.[0]?.b64_json;
  const imageDataUrl = typeof b64 === "string"
    ? `data:image/png;base64,${b64}`
    : data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return null;
  }

  const parsed = parseDataUrl(imageDataUrl);
  return { bytes: parsed.bytes, mime: parsed.mime || "image/png" };
}

async function generateWithPollinations(
  prompt: string,
  model: string,
  width: number,
  height: number,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const apiKey = Deno.env.get("POLLINATIONS_API_KEY");
  if (!apiKey) return null;

  const url = new URL(`https://gen.pollinations.ai/image/${encodeURIComponent(compactPromptForUrl(prompt))}`);
  url.searchParams.set("model", model);
  url.searchParams.set("width", String(width));
  url.searchParams.set("height", String(height));
  url.searchParams.set("nologo", "true");
  url.searchParams.set("private", "true");
  url.searchParams.set("enhance", "true");
  url.searchParams.set("safe", "true");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "image/*,application/json",
    },
  });

  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("Pollinations image generation failed:", model, res.status, errText);
    return null;
  }

  if (contentType.startsWith("image/")) {
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: contentType };
  }

  const data = await res.json().catch(() => null);
  const imageUrl = data?.url || data?.image || data?.images?.[0]?.url;
  if (typeof imageUrl === "string") {
    if (imageUrl.startsWith("data:image/")) {
      const parsed = parseDataUrl(imageUrl);
      return { bytes: parsed.bytes, mime: parsed.mime || "image/png" };
    }
    return await downloadImageFromUrl(imageUrl);
  }

  return null;
}

async function generateWithHuggingFace(
  prompt: string,
  providerId: string,
  width: number,
  height: number,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const apiKey = Deno.env.get("HUGGINGFACE_API_TOKEN") || Deno.env.get("HF_TOKEN");
  if (!apiKey) return null;

  const res = await fetch(`https://router.huggingface.co/fal-ai/${providerId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json,image/*",
    },
    body: JSON.stringify({
      prompt,
      image_size: { width, height },
      num_images: 1,
      num_inference_steps: 32,
      guidance_scale: 4.5,
      sync_mode: true,
      enable_safety_checker: true,
      output_format: "png",
    }),
  });

  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("Hugging Face image generation failed:", providerId, res.status, errText);
    return null;
  }

  if (contentType.startsWith("image/")) {
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: contentType };
  }

  const data = await res.json().catch(() => null);
  const imageUrl = data?.images?.[0]?.url || data?.image?.url || data?.url;
  if (typeof imageUrl === "string") {
    if (imageUrl.startsWith("data:image/")) {
      const parsed = parseDataUrl(imageUrl);
      return { bytes: parsed.bytes, mime: parsed.mime || "image/png" };
    }
    return await downloadImageFromUrl(imageUrl);
  }

  return null;
}

async function generateWithGeminiStudioImage(
  userInstruction: string,
  referenceImageUrl: string
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) return null;

  // Gemini requires inline bytes or file URIs; for reference-edit we use inline bytes.
  const { bytes, mime } = await resolveReferenceImageToBytes(referenceImageUrl);
  const base64 = bytesToBase64(bytes);

  const parts: any[] = [
    { inlineData: { mimeType: mime, data: base64 } },
    {
      text:
        `You are editing an existing image.\n` +
        `User instruction: ${userInstruction}\n\n` +
        `Rules:\n` +
        `- Preserve ALL other details exactly unless the user explicitly asks to change them.\n` +
        `- Do not add new objects, text, logos, or watermarks.\n` +
        `- Output only the edited image.`
    },
  ];

  const models = ["gemini-2.5-flash-image", "gemini-3.1-flash-image"];
  for (const studioModel of models) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${studioModel}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0.4 },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini Studio image edit failed:", studioModel, res.status, errText);
      continue;
    }

    const data = await res.json();
    const candidateParts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(candidateParts)) continue;

    for (const part of candidateParts) {
      const inline = part?.inlineData || part?.inline_data;
      if (inline?.data && (inline?.mimeType || inline?.mime_type)) {
        const outMime = inline.mimeType || inline.mime_type || "image/png";
        const outBytes = base64ToBytes(String(inline.data));
        return { bytes: outBytes, mime: outMime };
      }
    }
  }

  return null;
}

async function generateWithGeminiStudioTextToImage(
  prompt: string
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) return null;

  const models = ["gemini-2.5-flash-image", "gemini-3.1-flash-image"];
  for (const studioModel of models) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${studioModel}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0.6 },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini Studio text-to-image failed:", studioModel, res.status, errText);
      continue;
    }

    const data = await res.json();
    const candidateParts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(candidateParts)) continue;

    for (const part of candidateParts) {
      const inline = part?.inlineData || part?.inline_data;
      if (inline?.data && (inline?.mimeType || inline?.mime_type)) {
        const outMime = inline.mimeType || inline.mime_type || "image/png";
        const outBytes = base64ToBytes(String(inline.data));
        return { bytes: outBytes, mime: outMime };
      }
    }
  }
  return null;
}

async function generateWithLeonardo(
  prompt: string,
  width: number,
  height: number,
  referenceImageUrl?: string,
  modelId = "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3",
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const apiKey = Deno.env.get("LEONARDO_API_KEY_NEW") || Deno.env.get("LEONARDO_API_KEY");
  if (!apiKey) return null;

  let initImageUrl: string | undefined;
  if (referenceImageUrl) {
    initImageUrl = referenceImageUrl.startsWith("storage:")
      ? await resolveStorageRefToSignedUrl(referenceImageUrl)
      : referenceImageUrl;
  }

  const body: Record<string, unknown> = {
    prompt,
    modelId,
    width,
    height,
    num_images: 1,
    alchemy: true,
    presetStyle: "CINEMATIC",
    public: false,
  };

  if (initImageUrl) {
    body.init_image_url = initImageUrl;
    body.init_strength = 0.35;
  }

  const res = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("Leonardo image generation failed:", res.status, await res.text().catch(() => ""));
    return null;
  }

  const created = await res.json();
  const generationId = created?.sdGenerationJob?.generationId || created?.generationId || created?.generation?.id;
  if (!generationId) return null;

  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!poll.ok) continue;
    const data = await poll.json();
    const generation = data?.generations_by_pk || data?.generation || data;
    const status = String(generation?.status || "").toUpperCase();
    const imageUrl = generation?.generated_images?.[0]?.url || generation?.assets?.[0]?.url;
    if ((status === "COMPLETE" || status === "SUCCEEDED" || imageUrl) && imageUrl) {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) return null;
      return {
        bytes: new Uint8Array(await imgRes.arrayBuffer()),
        mime: imgRes.headers.get("content-type") || "image/png",
      };
    }
    if (["FAILED", "ERROR", "CANCELED"].includes(status)) return null;
  }

  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      prompt,
      imageDataUrl,
      referenceImageUrl,
      referenceMediaUrl,
      style = "photoreal",
      aspectRatio = "1:1",
      modelId,
      appInForeground,
      conversationId,
    } = await req.json();
    if (!prompt && !imageDataUrl) throw new Error("Prompt or imageDataUrl is required");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) throw new Error("Backend is not configured");
    if (!LOVABLE_API_KEY && !Deno.env.get("GEMINI_API_KEY")) {
      throw new Error("Image generation API key not configured");
    }

    // Auth
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    let userId = "anonymous";
    let userEmail = "";
    if (jwt) {
      const uc = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      });
      const { data } = await uc.auth.getUser();
      if (data?.user?.id) {
        userId = data.user.id;
        userEmail = data.user.email || "";
      }
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Subscription tier check + daily limit
    let tier = "free";
    if (userId !== "anonymous") {
      const { data: sub } = await admin
        .from("subscriptions")
        .select("tier, status, expires_at")
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();

      tier = sub && sub.status === "active" && (!sub.expires_at || new Date(sub.expires_at) > new Date())
        ? sub.tier
        : "free";

      const tierLimits: Record<string, number> = {
        free: 5,
        basic: 10,
        pro: 25,
        ultimate: 999999,
      };

      const dailyLimit = userEmail === CEO_EMAIL ? 20 : (tierLimits[tier] || 5);
      const today = new Date().toISOString().split("T")[0];
      const usedToday = await getDailyImageUsage(admin, userId, today);

      if (usedToday >= dailyLimit) {
        return new Response(
          JSON.stringify({
            error: `Daily image limit reached (${dailyLimit}/day). Upgrade your plan for more.`,
            limit_reached: true,
            remaining: 0,
            limit: dailyLimit,
            used: usedToday,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Direct upload (no AI)
    if (imageDataUrl && !prompt) {
      const { mime, bytes } = parseDataUrl(imageDataUrl);
      const ref = await uploadAndSave(admin, userId, "Uploaded image", style, aspectRatio, bytes, mime);
      return new Response(JSON.stringify({ image: ref }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stylePrompt = STYLE_PROMPTS[style] || "";
    // Beef up the visual prompt so the model gets rich, specific guidance
    // (a short user prompt like "gaming logo" produces weak output otherwise).
    const userPrompt = String(prompt).trim();
    const referenceUrl = referenceImageUrl || referenceMediaUrl;
    const isReferenceEdit = Boolean(referenceUrl);
    const enhancedPrompt = [
      isReferenceEdit ? `High-quality professional reference image edit.` : `High-quality professional image generation.`,
      ``,
      `Subject: ${userPrompt}`,
      stylePrompt ? `Style: ${stylePrompt}.` : `Style: clean, premium, realistic lighting and polished design.`,
      `Composition: well-balanced, clear focal subject, ${ASPECT_LABELS[aspectRatio] || aspectRatio} frame, no unwanted cropping.`,
      `Realism requirements: physically plausible lighting, real-world materials, authentic product/brand design details when the user explicitly requests a real brand, accurate shadows, natural camera depth, clean background integration, premium color grading.`,
      isReferenceEdit
        ? `Reference edit rules: preserve the original subject identity, pose, layout, background, colors, logos, typography, and all unrelated details. Change only what the user requested, keep the rest visually consistent with the reference image.`
        : `Design rules: make the scene specific and believable, with coherent objects, readable composition, and no generic filler details.`,
      `Avoid: distorted text, gibberish lettering, warped faces, extra fingers, extra limbs, mangled hands, messy artifacts, low-resolution textures, unwanted watermarks, random logos not requested by the user.`,
    ].join("\n");
    const dims = ASPECT_RATIO_MAP[aspectRatio] || ASPECT_RATIO_MAP["1:1"];


    // Free tier image generation uses normal Nano Banana unless a supported model is passed.
    const requestedModelKey = typeof modelId === "string" && IMAGE_MODELS[modelId] ? modelId : DEFAULT_MODEL;
    const selectedModelKey = requestedModelKey;
    const selectedModel = IMAGE_MODELS[selectedModelKey] || IMAGE_MODELS[DEFAULT_MODEL];

    let imgBytes: Uint8Array | null = null;
    let imgMime = "image/png";

    const useGenerated = (generated: { bytes: Uint8Array; mime: string } | null) => {
      if (!generated) return false;
      imgBytes = generated.bytes;
      imgMime = generated.mime;
      return true;
    };

    const tryModel = async (key: string, ref?: string) => {
      const model = IMAGE_MODELS[key];
      if (!model) return false;
      console.log(`[IMAGE] trying ${key} via ${model.provider}${ref ? " with reference" : ""}`);
      try {
        if (model.provider === "pollinations" && model.pollinationsModel && !ref) {
          return useGenerated(await generateWithPollinations(enhancedPrompt, model.pollinationsModel, dims.width, dims.height));
        }
        if (model.provider === "huggingface" && model.huggingFaceProviderId && !ref) {
          return useGenerated(await generateWithHuggingFace(enhancedPrompt, model.huggingFaceProviderId, dims.width, dims.height));
        }
        if (model.provider === "lovable" && model.lovableModel) {
          return useGenerated(await generateWithLovable(enhancedPrompt, model.lovableModel, ref));
        }
        if (model.provider === "leonardo") {
          return useGenerated(await generateWithLeonardo(enhancedPrompt, dims.width, dims.height, ref, model.leonardoId));
        }
      } catch (e) {
        console.error(`Image model failed (${key}):`, e);
      }
      return false;
    };

    if (referenceUrl) {
      const referenceFallbacks = Array.from(new Set([selectedModelKey, "nano_banana_2", "nano_banana", "phoenix"]));
      for (const key of referenceFallbacks) {
        if (await tryModel(key, referenceUrl)) break;
      }
      if (!imgBytes) {
        console.log(`[FALLBACK] Gemini Studio reference generation`);
        useGenerated(await generateWithGeminiStudioImage(enhancedPrompt, referenceUrl));
      }
    } else {
      const textFallbacks = Array.from(new Set([
        selectedModelKey,
        "pollinations_gpt_image_2",
        "pollinations_nanobanana_pro",
        "pollinations_seedream5",
        "pollinations_ideogram_quality",
        "hf_ideogram_4",
        "hf_flux_krea",
        "hf_qwen_image",
        "nano_banana_2",
        "nano_banana",
        "phoenix",
      ]));

      for (const key of textFallbacks) {
        if (await tryModel(key)) break;
      }

      if (!imgBytes) {
        console.log(`[FALLBACK] Gemini Studio text-to-image`);
        useGenerated(await generateWithGeminiStudioTextToImage(enhancedPrompt));
      }
    }

    if (!imgBytes) throw new Error("Image generation providers are temporarily unavailable or quota-limited. Please try again shortly.");

    const ref = await uploadAndSave(admin, userId, prompt, style, aspectRatio, imgBytes, imgMime);

    if (userId !== "anonymous") {
      await incrementDailyImageUsage(admin, userId, new Date().toISOString().split("T")[0]);
    }

    // If a conversationId is provided, insert the assistant message directly so the
    // image appears in chat via realtime even if the client request timed out.
    if (conversationId && userId !== "anonymous") {
      try {
        await admin.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: "Here's your image.",
          file_urls: [ref],
        });
      } catch (insertErr) {
        console.error("Failed to insert chat message for generated image (non-blocking):", insertErr);
      }
    }

    // Always send generation completion notification (push + email based on user prefs)
    if (userId !== "anonymous") {
      try {
        await sendGenerationNotification(admin, SUPABASE_URL!, SERVICE_ROLE_KEY!, userId, "image", prompt);
      } catch (notifErr) {
        console.error("Notification send failed (non-blocking):", notifErr);
      }
    }

    return new Response(JSON.stringify({ image: ref }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-image error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function sendGenerationNotification(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  type: "image" | "video",
  prompt: string
) {
  // Check user's notification preference
  const { data: profileData } = await admin
    .from("profiles")
    .select("notification_preference, notifications_enabled")
    .eq("user_id", userId)
    .single();

  if (!profileData?.notifications_enabled) return;

  const pref = profileData.notification_preference || "push_and_email";
  const shouldPush = pref === "push_and_email" || pref === "push_only";
  const shouldEmail = pref === "push_and_email" || pref === "email_only";

  const title = type === "image" ? "🎨 Image Ready!" : "🎬 Video Ready!";
  const body = `Your ${type} "${prompt.slice(0, 60)}" has been generated.`;

  // Push notification
  if (shouldPush) {
    try {
      const pushRes = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ userId, title, body, url: "/" }),
      });
      if (!pushRes.ok) console.error("Push failed:", pushRes.status);
    } catch (e) {
      console.error("Push error:", e);
    }
  }

  // Email notification
  if (shouldEmail) {
    const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
    if (BREVO_API_KEY) {
      try {
        const { data: userData } = await admin.auth.admin.getUserById(userId);
        const email = userData?.user?.email;
        if (email) {
          await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({
              sender: { name: "Astraz", email: "xtechnly@gmail.com" },
              to: [{ email }],
              subject: title,
              htmlContent: `
                <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <div style="background: linear-gradient(135deg, #00CED1, #9B59B6); padding: 20px; border-radius: 12px 12px 0 0;">
                    <h1 style="color: white; margin: 0;">${title}</h1>
                  </div>
                  <div style="background: #f8f9fa; padding: 24px; border-radius: 0 0 12px 12px;">
                    <p style="font-size: 16px; color: #333;">${body}</p>
                    <a href="https://astraz.lovable.app" style="display: inline-block; background: linear-gradient(135deg, #00CED1, #9B59B6); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 16px;">View in Astraz</a>
                  </div>
                </div>
              `,
            }),
          });
        }
      } catch (e) {
        console.error("Email error:", e);
      }
    }
  }
}
