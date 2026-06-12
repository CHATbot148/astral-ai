import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type VideoQuality = "720p" | "1080p";

type ModelConfig = {
  apiVersion: "v1" | "v2";
  apiModel: string;
  durations: number[];
  qualities: VideoQuality[];
};

const VIDEO_MODELS: Record<string, ModelConfig> = {
  kling_3: {
    apiVersion: "v2",
    apiModel: "kling-3.0",
    durations: [5, 10],
    qualities: ["720p", "1080p"],
  },
  veo_31_fast: {
    apiVersion: "v1",
    apiModel: "VEO3_1FAST",
    durations: [6, 8],
    qualities: ["720p", "1080p"],
  },
  hailuo_23: {
    apiVersion: "v1",
    apiModel: "HAILUO_2_3",
    durations: [6, 10],
    qualities: ["720p", "1080p"],
  },
};

const DEFAULT_MODEL = "kling_3";

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
    if (!LEONARDO_API_KEY) throw new Error("Leonardo API key is not configured");

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
      .select("tier, status, expires_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    const tier =
      sub && sub.status === "active" && (!sub.expires_at || new Date(sub.expires_at) > new Date())
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count } = await admin
      .from("generated_videos")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", today.toISOString());

    if ((count || 0) >= dailyLimit) {
      return new Response(
        JSON.stringify({
          error: `Daily video limit reached (${dailyLimit}/day). Upgrade for more.`,
          limit_reached: true,
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
    let generationPrompt = String(prompt);
    if (referenceMediaUrl && GEMINI_API_KEY) {
      try {
        let refUrl = String(referenceMediaUrl);
        if (refUrl.startsWith("storage:")) {
          refUrl = await resolveStorageRef(admin, refUrl);
        }
        const refRes = await fetch(refUrl);
        if (refRes.ok) {
          const bytes = await refRes.arrayBuffer();
          const contentType = refRes.headers.get("content-type") || "image/png";
          if (contentType.startsWith("image/")) {
            const desc = await describeReference(GEMINI_API_KEY, bytes, contentType);
            if (desc) generationPrompt = `${prompt}\n\nReference description: ${desc}`;
            console.log(`[generate-video] Reference described (${contentType})`);
          }
        }
      } catch (e) {
        console.error("Reference analysis failed (non-blocking):", e);
      }
    }

    console.log(
      `[generate-video] model=${selectedModel} (${config.apiModel}) api=${config.apiVersion} duration=${effectiveDuration} quality=${effectiveQuality}`
    );

    let videoUrl: string;

    if (config.apiVersion === "v2") {
      videoUrl = await generateV2(
        LEONARDO_API_KEY,
        config.apiModel,
        generationPrompt,
        effectiveDuration,
        effectiveQuality,
        vidWidth,
        vidHeight
      );
    } else {
      videoUrl = await generateV1TextToVideo(
        LEONARDO_API_KEY,
        config.apiModel,
        generationPrompt,
        effectiveDuration,
        vidWidth,
        vidHeight
      );
    }

    const ref = await uploadVideo(admin, userId, prompt, videoUrl);

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
