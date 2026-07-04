import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type VideoQuality = "720p" | "1080p";

type ModelConfig = {
  provider: "pollinations" | "puter" | "leonardo";
  apiVersion?: "v1" | "v2";
  apiModel: string;
  durations: number[];
  qualities: VideoQuality[];
};

const VIDEO_MODELS: Record<string, ModelConfig> = {
  pollinations_veo: {
    provider: "pollinations",
    apiModel: "veo",
    durations: [4, 6, 8],
    qualities: ["720p", "1080p"],
  },
  pollinations_seedance_pro: {
    provider: "pollinations",
    apiModel: "seedance-pro",
    durations: [5, 8, 10],
    qualities: ["720p", "1080p"],
  },
  pollinations_wan_pro: {
    provider: "pollinations",
    apiModel: "wan-pro-1080p",
    durations: [5, 8, 10],
    qualities: ["720p", "1080p"],
  },
  puter_sora_2_pro: {
    provider: "puter",
    apiModel: "sora-2-pro",
    durations: [4, 8, 12],
    qualities: ["720p", "1080p"],
  },
  puter_veo_31_lite: {
    provider: "puter",
    apiModel: "veo-3.1-lite-generate-preview",
    durations: [4, 6, 8],
    qualities: ["720p", "1080p"],
  },
  kling_3: {
    provider: "leonardo",
    apiVersion: "v2",
    apiModel: "kling-3.0",
    durations: [5, 10],
    qualities: ["720p", "1080p"],
  },
  veo_31_fast: {
    provider: "leonardo",
    apiVersion: "v1",
    apiModel: "VEO3_1FAST",
    durations: [6, 8],
    qualities: ["720p", "1080p"],
  },
  hailuo_23: {
    provider: "leonardo",
    apiVersion: "v1",
    apiModel: "HAILUO_2_3",
    durations: [6, 10],
    qualities: ["720p", "1080p"],
  },
};

const DEFAULT_MODEL = "pollinations_veo";

const ASPECT_BY_QUALITY: Record<VideoQuality, { width: number; height: number; size: string }> = {
  "720p": { width: 1280, height: 720, size: "1280x720" },
  "1080p": { width: 1920, height: 1080, size: "1920x1080" },
};

function pickDuration(val: unknown, supported: number[]): number {
  const n = typeof val === "number" ? val : Number(val);
  return Number.isFinite(n) && supported.includes(n) ? n : supported[0];
}

function pickQuality(val: unknown, supported: VideoQuality[]): VideoQuality {
  const s = String(val || "") as VideoQuality;
  return supported.includes(s) ? s : supported[0];
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) throw new Error("Invalid media data");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime: match[1], bytes };
}

async function resolveStorageRef(
  admin: ReturnType<typeof createClient>,
  ref: string
): Promise<string> {
  const raw = ref.slice("storage:".length);
  const slash = raw.indexOf("/");
  const bucket = raw.slice(0, slash);
  const path = raw.slice(slash + 1);
  const { data } = await admin.storage.from(bucket).createSignedUrl(path, 3600);
  return data?.signedUrl || ref;
}

// Describe reference image via Gemini for prompt augmentation
async function describeReference(
  geminiKey: string,
  imageBytes: ArrayBuffer,
  contentType: string
): Promise<string> {
  const base64 = bytesToBase64(new Uint8Array(imageBytes));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: contentType, data: base64 } },
              {
                text: "Describe this image for video generation. Return a concise description of: subject(s), setting, style, colors, lighting, camera angle, and mood. Do not add guesses.",
              },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 384, temperature: 0.2 },
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini reference analysis failed (${res.status}): ${t}`);
  }
  const data = await res.json();
  return String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

// ===== v2 generation (Kling 3.0) =====
async function generateV2(
  apiKey: string,
  model: string,
  prompt: string,
  duration: number,
  quality: VideoQuality,
  width: number,
  height: number
): Promise<string> {
  const mode = quality === "1080p" ? "RESOLUTION_1080" : "RESOLUTION_720";

  console.log(`[v2] POST /api/rest/v2/generations model=${model} duration=${duration} mode=${mode}`);
  const res = await fetch("https://cloud.leonardo.ai/api/rest/v2/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      duration,
      mode,
      width,
      height,
      public: false,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Leonardo v2 generation failed (${res.status}): ${t}`);
  }

  const data = await res.json();
  const genId = data.generationId || data.generation?.id;
  if (!genId) throw new Error("No generationId from Leonardo v2: " + JSON.stringify(data));

  console.log(`[v2] generation started: ${genId}`);

  // Poll v2
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await fetch(`https://cloud.leonardo.ai/api/rest/v2/generations/${genId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!poll.ok) continue;
    const pd = await poll.json();
    const gen = pd.generation || pd;

    if (gen.status === "COMPLETE") {
      const videoAsset = gen.assets?.find((a: any) => a.url?.includes(".mp4") || a.type === "VIDEO");
      const url = videoAsset?.url || gen.assets?.[0]?.url;
      if (url) return url;

      // Fallback: check generated_images pattern
      const img = gen.generated_images?.find((i: any) => i.motionMP4URL || i.url?.endsWith(".mp4"));
      if (img?.motionMP4URL) return img.motionMP4URL;
      if (img?.url) return img.url;

      throw new Error("v2 generation completed but no video URL found");
    }
    if (gen.status === "FAILED") throw new Error("Video generation failed on Leonardo");
  }
  throw new Error("Video generation timed out");
}

// ===== v1 text-to-video generation (Veo 3.1 Fast, Hailuo 2.3) =====
async function generateV1TextToVideo(
  apiKey: string,
  model: string,
  prompt: string,
  duration: number,
  width: number,
  height: number
): Promise<string> {
  console.log(`[v1-t2v] POST model=${model} duration=${duration} ${width}x${height}`);
  const res = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations-text-to-video", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      prompt,
      model,
      height,
      width,
      isPublic: false,
      frameInterpolation: true,
      ...(duration ? { duration } : {}),
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Leonardo v1 text-to-video failed (${res.status}): ${t}`);
  }

  const data = await res.json();
  const genId =
    data.textToVideoGenerationJob?.generationId ||
    data.motionVideoGenerationJob?.generationId ||
    data.generationId;
  if (!genId) throw new Error("No generationId from v1 t2v: " + JSON.stringify(data));

  console.log(`[v1-t2v] generation started: ${genId}`);

  // Poll v1
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${genId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!poll.ok) continue;
    const pd = await poll.json();
    const gen = pd.generations_by_pk;

    if (gen?.status === "COMPLETE") {
      const vid = gen.generated_images?.find(
        (i: any) => i.motionMP4URL || i.url?.endsWith(".mp4")
      );
      if (vid?.motionMP4URL) return vid.motionMP4URL;
      if (vid?.url) return vid.url;
      throw new Error("v1 generation completed but no video URL found");
    }
    if (gen?.status === "FAILED") throw new Error("Video generation failed on Leonardo");
  }
  throw new Error("Video generation timed out");
}

async function generateWithPollinationsVideo(
  prompt: string,
  model: string,
  duration: number,
  quality: VideoQuality,
  referenceMediaUrl?: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const apiKey = Deno.env.get("POLLINATIONS_API_KEY");
  if (!apiKey) throw new Error("Pollinations API key is not configured");

  const dims = ASPECT_BY_QUALITY[quality];
  const url = new URL(`https://gen.pollinations.ai/video/${encodeURIComponent(prompt.replace(/\s+/g, " ").trim().slice(0, 1800))}`);
  url.searchParams.set("model", model);
  url.searchParams.set("duration", String(duration));
  url.searchParams.set("aspectRatio", "16:9");
  url.searchParams.set("nologo", "true");
  url.searchParams.set("private", "true");
  url.searchParams.set("safe", "true");
  url.searchParams.set("width", String(dims.width));
  url.searchParams.set("height", String(dims.height));
  if (referenceMediaUrl) {
    url.searchParams.set("referenceImage", referenceMediaUrl.startsWith("storage:") ? referenceMediaUrl : referenceMediaUrl);
    url.searchParams.set("image", referenceMediaUrl.startsWith("storage:") ? referenceMediaUrl : referenceMediaUrl);
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "video/mp4,application/json,*/*" },
  });
  const contentType = res.headers.get("content-type") || "video/mp4";
  if (!res.ok) throw new Error(`Pollinations video generation failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  if (contentType.startsWith("video/") || contentType === "application/octet-stream") {
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: contentType.startsWith("video/") ? contentType : "video/mp4" };
  }

  const data = await res.json().catch(() => null);
  const videoUrl = data?.url || data?.video || data?.videos?.[0]?.url;
  if (!videoUrl || typeof videoUrl !== "string") throw new Error("Pollinations returned no video URL");
  const dl = await fetch(videoUrl);
  if (!dl.ok) throw new Error("Failed to download Pollinations video");
  return { bytes: new Uint8Array(await dl.arrayBuffer()), mime: dl.headers.get("content-type") || "video/mp4" };
}

async function generateWithPuterVideo(
  prompt: string,
  model: string,
  duration: number,
  quality: VideoQuality,
  referenceMediaUrl?: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const token = Deno.env.get("PUTER_API_KEY") || Deno.env.get("PUTER_AUTH_TOKEN");
  if (!token) throw new Error("Puter API key is not configured");
  const dims = ASPECT_BY_QUALITY[quality];
  const mod = await import("npm:@heyputer/puter.js/src/init.cjs");
  const puter = mod.init(token);
  let inputReference = referenceMediaUrl;
  if (inputReference?.startsWith("storage:")) inputReference = await resolveStorageRef(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!), inputReference);
  const video = await puter.ai.txt2vid({
    prompt,
    model,
    seconds: duration,
    size: dims.size,
    resolution: dims.size,
    ...(inputReference ? { input_reference: inputReference } : {}),
  });
  const src = typeof video === "string" ? video : video?.src || video?.url || video?.data?.url || video?.dataUrl;
  if (!src || typeof src !== "string") throw new Error("Puter returned no video URL");
  if (src.startsWith("data:")) return parseDataUrl(src);
  const dl = await fetch(src);
  if (!dl.ok) throw new Error("Failed to download Puter video");
  return { bytes: new Uint8Array(await dl.arrayBuffer()), mime: dl.headers.get("content-type") || "video/mp4" };
}

async function uploadVideo(
  admin: ReturnType<typeof createClient>,
  userId: string,
  prompt: string,
  videoUrl: string
): Promise<string> {
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error("Failed to download generated video");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const path = `${userId}/generated/vid-${Date.now()}.mp4`;
  const { error } = await admin.storage
    .from("chat-files")
    .upload(path, bytes, { contentType: "video/mp4", upsert: false });
  if (error) throw error;
  const ref = `storage:chat-files/${path}`;
  if (userId !== "anonymous") {
    await admin.from("generated_videos").insert({ user_id: userId, prompt, video_url: ref });
  }
  return ref;
}

async function uploadVideoBytes(
  admin: ReturnType<typeof createClient>,
  userId: string,
  prompt: string,
  bytes: Uint8Array,
  mime = "video/mp4",
): Promise<string> {
  const ext = mime.includes("webm") ? "webm" : mime.includes("quicktime") ? "mov" : "mp4";
  const path = `${userId}/generated/vid-${Date.now()}.${ext}`;
  const { error } = await admin.storage
    .from("chat-files")
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw error;
  const ref = `storage:chat-files/${path}`;
  if (userId !== "anonymous") {
    await admin.from("generated_videos").insert({ user_id: userId, prompt, video_url: ref });
  }
  return ref;
}

async function getDailyVideoUsage(admin: ReturnType<typeof createClient>, userId: string, usageDate: string): Promise<number> {
  const { data } = await admin
    .from("daily_usage")
    .select("videos_generated")
    .eq("user_id", userId)
    .eq("usage_date", usageDate)
    .maybeSingle();
  return Number(data?.videos_generated || 0);
}

async function incrementDailyVideoUsage(admin: ReturnType<typeof createClient>, userId: string, usageDate: string) {
  const { data: existing } = await admin
    .from("daily_usage")
    .select("id, images_generated, videos_generated")
    .eq("user_id", userId)
    .eq("usage_date", usageDate)
    .maybeSingle();
  if (existing?.id) {
    await admin.from("daily_usage").update({ videos_generated: Number(existing.videos_generated || 0) + 1, updated_at: new Date().toISOString() }).eq("id", existing.id);
  } else {
    await admin.from("daily_usage").insert({ user_id: userId, usage_date: usageDate, images_generated: 0, videos_generated: 1 });
  }
}

async function sendNotification(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  prompt: string
) {
  const { data: profileData } = await admin
    .from("profiles")
    .select("notification_preference, notifications_enabled")
    .eq("user_id", userId)
    .single();
  if (!profileData?.notifications_enabled) return;

  const pref = profileData.notification_preference || "push_and_email";
  const title = "🎬 Video Ready!";
  const body = `Your video "${prompt.slice(0, 60)}" has been generated.`;

  if (pref === "push_and_email" || pref === "push_only") {
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ userId, title, body, url: "/" }),
      });
    } catch (e) {
      console.error("Push error:", e);
    }
  }

  if (pref === "push_and_email" || pref === "email_only") {
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, modelId, duration, quality, referenceMediaUrl } = await req.json();
    if (!prompt) throw new Error("Prompt is required");

    const LEONARDO_API_KEY = Deno.env.get("LEONARDO_API_KEY_NEW") || Deno.env.get("LEONARDO_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY)
      throw new Error("Backend not configured");
    if (!Deno.env.get("POLLINATIONS_API_KEY") && !Deno.env.get("PUTER_API_KEY") && !Deno.env.get("PUTER_AUTH_TOKEN") && !LEONARDO_API_KEY) {
      throw new Error("Video generation API key is not configured");
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
      if (data?.user?.id) userId = data.user.id;
      if (data?.user?.email) userEmail = data.user.email;
    }

    const CEO_EMAIL = "khaleelktn@gmail.com";
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    if (userId === "anonymous") {
      return new Response(
        JSON.stringify({ error: "Please sign in and subscribe to generate videos." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Subscription check
    const { data: sub } = await admin
      .from("subscriptions")
      .select("tier, status, expires_at, access_until")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    const subAccessUntil = sub?.access_until || sub?.expires_at;
    const tier =
      sub && sub.status === "active" && (!subAccessUntil || new Date(subAccessUntil) > new Date())
        ? sub.tier
        : "free";

    if (tier === "free") {
      return new Response(
        JSON.stringify({ error: "Video generation requires a paid plan.", limit_reached: true }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tierLimits: Record<string, number> = { free: 0, basic: 2, pro: 8, ultimate: 999999 };
    const dailyLimit = userEmail === CEO_EMAIL ? 20 : tierLimits[tier] || 0;

    const todayKey = new Date().toISOString().split("T")[0];
    const usedToday = await getDailyVideoUsage(admin, userId, todayKey);

    if (usedToday >= dailyLimit) {
      return new Response(
        JSON.stringify({
          error: `Daily video limit reached (${dailyLimit}/day). Upgrade for more.`,
          limit_reached: true,
          limit: dailyLimit,
          used: usedToday,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve model
    const selectedModel = VIDEO_MODELS[modelId] ? String(modelId) : DEFAULT_MODEL;
    const config = VIDEO_MODELS[selectedModel];
    const effectiveDuration = pickDuration(duration, config.durations);
    const effectiveQuality = pickQuality(quality, config.qualities);
    const is1080 = effectiveQuality === "1080p";
    const vidWidth = is1080 ? 1920 : 1280;
    const vidHeight = is1080 ? 1080 : 720;

    // Handle reference media (describe via Gemini and augment prompt)
    let effectiveReferenceMediaUrl = referenceMediaUrl ? String(referenceMediaUrl) : undefined;
    if (effectiveReferenceMediaUrl?.startsWith("storage:")) {
      effectiveReferenceMediaUrl = await resolveStorageRef(admin, effectiveReferenceMediaUrl);
    }

    const basePrompt = String(prompt).trim();
    let generationPrompt = [
      `Create a premium, photorealistic, cinematic video clip.`,
      `Scene: ${basePrompt}`,
      `Motion: natural physically plausible movement, smooth camera path, stable framing, realistic parallax, believable timing, no random jump cuts.`,
      `Visual quality: high-end commercial production, real-world materials, clean lighting, accurate shadows/reflections, detailed textures, rich but natural color grade, sharp subject separation.`,
      `Composition: 16:9 professional framing, clear focal subject, no awkward cropping, no unwanted text or watermark.`,
      `Avoid: flicker, morphing objects, warped faces/hands, melting details, jitter, over-smoothed plastic surfaces, unreadable text, fake logos unless explicitly requested.`,
    ].join("\n");
    if (referenceMediaUrl && GEMINI_API_KEY) {
      try {
        const refRes = await fetch(effectiveReferenceMediaUrl || String(referenceMediaUrl));
        if (refRes.ok) {
          const bytes = await refRes.arrayBuffer();
          const contentType = refRes.headers.get("content-type") || "image/png";
          if (contentType.startsWith("image/")) {
            const desc = await describeReference(GEMINI_API_KEY, bytes, contentType);
            if (desc) generationPrompt += `\nReference preservation: use this image as source-of-truth for subject identity, style, lighting, colors, composition, and background unless the prompt explicitly changes them. Reference description: ${desc}`;
            console.log(`[generate-video] Reference described (${contentType})`);
          }
        }
      } catch (e) {
        console.error("Reference analysis failed (non-blocking):", e);
      }
    }

    console.log(
      `[generate-video] model=${selectedModel} (${config.apiModel}) provider=${config.provider} api=${config.apiVersion || "native"} duration=${effectiveDuration} quality=${effectiveQuality}`
    );

    let ref: string | null = null;
    const fallbackKeys = Array.from(new Set([selectedModel, "pollinations_veo", "pollinations_seedance_pro", "pollinations_wan_pro", "puter_sora_2_pro", "puter_veo_31_lite", "kling_3", "veo_31_fast"]));
    for (const key of fallbackKeys) {
      const attempt = VIDEO_MODELS[key];
      if (!attempt) continue;
      try {
        if (attempt.provider === "pollinations") {
          const vid = await generateWithPollinationsVideo(generationPrompt, attempt.apiModel, pickDuration(effectiveDuration, attempt.durations), effectiveQuality, effectiveReferenceMediaUrl);
          ref = await uploadVideoBytes(admin, userId, prompt, vid.bytes, vid.mime);
          break;
        }
        if (attempt.provider === "puter") {
          const vid = await generateWithPuterVideo(generationPrompt, attempt.apiModel, pickDuration(effectiveDuration, attempt.durations), effectiveQuality, effectiveReferenceMediaUrl);
          ref = await uploadVideoBytes(admin, userId, prompt, vid.bytes, vid.mime);
          break;
        }
        if (attempt.provider === "leonardo" && LEONARDO_API_KEY) {
          const videoUrl = attempt.apiVersion === "v2"
            ? await generateV2(LEONARDO_API_KEY, attempt.apiModel, generationPrompt, pickDuration(effectiveDuration, attempt.durations), effectiveQuality, vidWidth, vidHeight)
            : await generateV1TextToVideo(LEONARDO_API_KEY, attempt.apiModel, generationPrompt, pickDuration(effectiveDuration, attempt.durations), vidWidth, vidHeight);
          ref = await uploadVideo(admin, userId, prompt, videoUrl);
          break;
        }
      } catch (providerError) {
        console.error(`[generate-video] provider failed ${key}:`, providerError);
      }
    }

    if (!ref) throw new Error("Video generation providers are temporarily unavailable or quota-limited. Please try again shortly.");
    await incrementDailyVideoUsage(admin, userId, todayKey);

    try {
      await sendNotification(admin, SUPABASE_URL, SERVICE_ROLE_KEY, userId, prompt);
    } catch (e) {
      console.error("Notification failed (non-blocking):", e);
    }

    return new Response(JSON.stringify({ video: ref }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-video error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
