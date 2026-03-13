import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VIDEO_MODELS: Record<string, { apiModel?: string }> = {
  sora_2: { apiModel: "sora-2" },
  sora_2_pro: { apiModel: "sora-2-pro" },
  motion_2: {},
};

const DEFAULT_VIDEO_MODEL = "sora_2";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function resolveStorageRefToSignedUrl(
  admin: ReturnType<typeof createClient>,
  storageRef: string
): Promise<string> {
  // storage:bucket/path
  const raw = storageRef.slice("storage:".length);
  const slashIdx = raw.indexOf("/");
  const bucket = raw.slice(0, slashIdx);
  const path = raw.slice(slashIdx + 1);
  const { data } = await admin.storage.from(bucket).createSignedUrl(path, 60 * 60);
  return data?.signedUrl || storageRef;
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

  // Wait for processing
  let state = info?.file?.state;
  let attempts = 0;
  while (state === "PROCESSING" && attempts < 30) {
    await new Promise((r) => setTimeout(r, 2000));
    const checkRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${geminiKey}`
    );
    const checkData = await checkRes.json();
    state = checkData.state;
    attempts++;
  }

  if (state !== "ACTIVE") {
    throw new Error(`Reference media processing failed (${state || "unknown"})`);
  }

  return { fileUri, mimeType: contentType, fileName };
}

async function describeReferenceWithGemini(
  geminiKey: string,
  mediaBytes: ArrayBuffer,
  contentType: string
): Promise<string> {
  const instruction =
    "Describe the reference media for video generation. " +
    "Return a concise description of: subject(s), setting, style, colors, lighting, camera angle, and mood. " +
    "If there is a logo/text, describe it faithfully. Do not add extra guesses.";

  // Inline only for non-gif images (small enough in typical cases)
  const isInlineImage = contentType.startsWith("image/") && contentType !== "image/gif";

  let parts: any[];
  if (isInlineImage) {
    const base64 = bytesToBase64(new Uint8Array(mediaBytes));
    parts = [{ inlineData: { mimeType: contentType, data: base64 } }, { text: instruction }];
  } else {
    // Video/GIF via Files API
    const supported =
      contentType === "video/mp4" ||
      contentType === "video/webm" ||
      contentType === "image/gif" ||
      contentType.startsWith("video/");

    if (!supported) {
      throw new Error(`Unsupported reference media type: ${contentType}`);
    }

    const uploaded = await geminiUploadResumable(geminiKey, mediaBytes, contentType);
    parts = [{ fileData: { mimeType: uploaded.mimeType, fileUri: uploaded.fileUri } }, { text: instruction }];
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { maxOutputTokens: 384, temperature: 0.2 },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini reference analysis failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return String(text || "").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, modelId, duration, quality, appInForeground, referenceMediaUrl } = await req.json();
    if (!prompt) throw new Error("Prompt is required");

    const LEONARDO_API_KEY = Deno.env.get("LEONARDO_API_KEY_NEW") || Deno.env.get("LEONARDO_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) throw new Error("Backend not configured");
    if (!LEONARDO_API_KEY) throw new Error("Video generation API key not configured");

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
        JSON.stringify({
          error: "Please sign in and subscribe to generate videos.",
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Subscription tier check + daily video limits
    const { data: sub } = await admin
      .from("subscriptions")
      .select("tier, status, expires_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    const tier = sub && sub.status === "active" && (!sub.expires_at || new Date(sub.expires_at) > new Date())
      ? sub.tier
      : "free";

    if (tier === "free") {
      return new Response(
        JSON.stringify({
          error: "Video generation requires a paid plan. Please upgrade.",
          limit_reached: true,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tierLimits: Record<string, number> = {
      free: 0,
      basic: 2,
      pro: 8,
      ultimate: 999999,
    };
    const dailyLimit = userEmail === CEO_EMAIL ? 20 : (tierLimits[tier] || 0);

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

    // Reference media -> use Gemini Veo for generation when reference is provided
    let generationPrompt = String(prompt);
    let useGeminiVeo = false;

    if (referenceMediaUrl) {
      if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured for reference-based generation");
      useGeminiVeo = true; // Always use Veo when reference media is provided
    }

    // Also use Veo if user selected a veo model
    const isVeoModel = modelId?.startsWith("veo_");
    if (isVeoModel && GEMINI_API_KEY) {
      useGeminiVeo = true;
    }

    if (useGeminiVeo) {
      console.log(`[generate-video] Using Gemini Veo for generation (reference: ${!!referenceMediaUrl})`);

      // Determine Veo model
      const veoModelMap: Record<string, string> = {
        veo_3: "veo-3.0-generate-preview",
        veo_31: "veo-3.1-generate-preview",
        veo_31_fast: "veo-3.1-fast-generate-preview",
      };
      const veoModel = (modelId && veoModelMap[modelId]) || "veo-3.1-generate-preview";

      // Build request body
      const veoBody: any = {
        instances: [{ prompt: prompt }],
        parameters: {
          aspectRatio: quality === "1080p" ? "16:9" : "16:9",
          personGeneration: "allow_all",
          durationSeconds: duration === 10 ? 10 : 6,
        },
      };

      // If reference media, upload to Gemini Files API and use as image input
      if (referenceMediaUrl) {
        let refUrl = String(referenceMediaUrl);
        if (refUrl.startsWith("storage:")) {
          refUrl = await resolveStorageRefToSignedUrl(admin, refUrl);
        }

        const refRes = await fetch(refUrl);
        if (!refRes.ok) throw new Error(`Failed to download reference media (${refRes.status})`);
        const refBytes = await refRes.arrayBuffer();
        const refContentType = refRes.headers.get("content-type") || "image/png";

        if (refContentType.startsWith("image/")) {
          // Image-to-video: pass image as reference
          const base64 = bytesToBase64(new Uint8Array(refBytes));
          veoBody.instances[0].image = {
            bytesBase64Encoded: base64,
            mimeType: refContentType,
          };
          console.log(`[generate-video] Added image reference (${refContentType})`);
        } else {
          // Video reference: describe it with Gemini and augment prompt
          try {
            const desc = await describeReferenceWithGemini(GEMINI_API_KEY!, refBytes, refContentType);
            if (desc) {
              veoBody.instances[0].prompt = `${prompt}\n\nReference description: ${desc}`;
            }
          } catch (e) {
            console.error("Video reference analysis failed:", e);
          }
        }
      }

      // Call Veo API
      const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
      const veoRes = await fetch(`${BASE_URL}/models/${veoModel}:predictLongRunning`, {
        method: "POST",
        headers: {
          "x-goog-api-key": GEMINI_API_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(veoBody),
      });

      if (!veoRes.ok) {
        const errText = await veoRes.text();
        console.error(`Veo API error (${veoRes.status}):`, errText);
        // Fall back to Leonardo if Veo fails
        console.log("[generate-video] Veo failed, falling back to Leonardo...");
      } else {
        const veoData = await veoRes.json();
        const operationName = veoData.name;
        if (!operationName) throw new Error("No operation name from Veo API");

        console.log(`[generate-video] Veo operation started: ${operationName}`);

        // Poll for completion (up to 5 minutes)
        let videoUri = "";
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 5000));
          const pollRes = await fetch(`${BASE_URL}/${operationName}`, {
            headers: { "x-goog-api-key": GEMINI_API_KEY! },
          });

          if (!pollRes.ok) continue;
          const pollData = await pollRes.json();

          if (pollData.done) {
            const samples = pollData.response?.generateVideoResponse?.generatedSamples;
            if (samples && samples.length > 0) {
              videoUri = samples[0]?.video?.uri;
            }
            if (!videoUri) {
              const errMsg = pollData.error?.message || "Video generation failed";
              throw new Error(errMsg);
            }
            break;
          }
        }

        if (!videoUri) throw new Error("Veo video generation timed out");

        // Download the video using the API key
        const videoDownload = await fetch(`${videoUri}`, {
          headers: { "x-goog-api-key": GEMINI_API_KEY! },
          redirect: "follow",
        });
        if (!videoDownload.ok) throw new Error("Failed to download Veo video");

        const videoBytes = new Uint8Array(await videoDownload.arrayBuffer());
        const path = `${userId}/generated/vid-${Date.now()}.mp4`;
        const { error: uploadError } = await admin.storage
          .from("chat-files")
          .upload(path, videoBytes, { contentType: "video/mp4", upsert: false });
        if (uploadError) throw uploadError;

        const ref = `storage:chat-files/${path}`;

        if (userId !== "anonymous") {
          await admin.from("generated_videos").insert({ user_id: userId, prompt, video_url: ref });
        }

        try {
          await sendGenerationNotification(admin, SUPABASE_URL!, SERVICE_ROLE_KEY!, userId, "video", prompt);
        } catch (notifErr) {
          console.error("Notification send failed (non-blocking):", notifErr);
        }

        return new Response(JSON.stringify({ video: ref }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Leonardo fallback / default path
    generationPrompt = String(prompt);
    if (referenceMediaUrl && GEMINI_API_KEY) {
      // If we got here, Veo failed but we still have reference - describe it for Leonardo
      let refUrl = String(referenceMediaUrl);
      if (refUrl.startsWith("storage:")) {
        refUrl = await resolveStorageRefToSignedUrl(admin, refUrl);
      }
      try {
        const refRes = await fetch(refUrl);
        if (refRes.ok) {
          const bytes = await refRes.arrayBuffer();
          const contentType = refRes.headers.get("content-type") || "application/octet-stream";
          const desc = await describeReferenceWithGemini(GEMINI_API_KEY, bytes, contentType);
          if (desc) generationPrompt = `${prompt}\n\nReference description: ${desc}`;
        }
      } catch (e) {
        console.error("Reference fallback analysis failed:", e);
      }
    }

    const selectedModel = VIDEO_MODELS[modelId] ? modelId : DEFAULT_VIDEO_MODEL;
    const selectedConfig = VIDEO_MODELS[selectedModel];

    // Determine resolution from quality param (paid users can pick 1080p)
    const is1080 = quality === "1080p";
    const vidWidth = is1080 ? 1920 : 1280;
    const vidHeight = is1080 ? 1080 : 720;

    // Duration: 6 or 10 seconds (default 6)
    const vidDuration = duration === 10 ? 10 : 6;

    console.log(
      `Generating video with Leonardo text-to-video (${selectedModel}): "${generationPrompt}" | ${vidWidth}x${vidHeight} | ${vidDuration}s`
    );

    // Use Leonardo's direct text-to-video endpoint
    const createRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations-text-to-video", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LEONARDO_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        prompt: generationPrompt,
        height: vidHeight,
        width: vidWidth,
        isPublic: false,
        frameInterpolation: true,
        ...(vidDuration === 10 ? { duration: 10 } : {}),
        ...(selectedConfig?.apiModel ? { model: selectedConfig.apiModel } : {}),
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error("Leonardo text-to-video error:", createRes.status, errText);
      console.log("Falling back to image → motion SVD approach...");
      return await imageToMotionFallback(
        generationPrompt,
        LEONARDO_API_KEY,
        SUPABASE_URL,
        SERVICE_ROLE_KEY!,
        userId,
        prompt
      );
    }

    const createData = await createRes.json();
    const generationId =
      createData.motionVideoGenerationJob?.generationId ||
      createData.textToVideoGenerationJob?.generationId ||
      createData.generationId;

    if (!generationId) {
      console.error("No generationId from text-to-video:", JSON.stringify(createData));
      return await imageToMotionFallback(
        generationPrompt,
        LEONARDO_API_KEY,
        SUPABASE_URL,
        SERVICE_ROLE_KEY!,
        userId,
        prompt
      );
    }

    console.log(`Text-to-video generation started, ID: ${generationId}`);

    // Poll for completion (up to 150 seconds)
    let videoUrl = "";
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`, {
        headers: { Authorization: `Bearer ${LEONARDO_API_KEY}`, Accept: "application/json" },
      });

      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      const gen = pollData.generations_by_pk;

      if (gen?.status === "COMPLETE") {
        const videoItem = gen.generated_images?.find((img: any) => img.motionMP4URL || img.url?.endsWith(".mp4"));
        if (videoItem?.motionMP4URL) {
          videoUrl = videoItem.motionMP4URL;
          break;
        }
        if (videoItem?.url) {
          videoUrl = videoItem.url;
          break;
        }
      }
      if (gen?.status === "FAILED") throw new Error("Video generation failed. Please try again.");
    }

    if (!videoUrl) throw new Error("Video generation timed out. Please try again.");

    const ref = await uploadVideo(admin, userId, prompt, videoUrl);

    // Always send generation completion notification (push + email based on user prefs)
    try {
      await sendGenerationNotification(admin, SUPABASE_URL!, SERVICE_ROLE_KEY!, userId, "video", prompt);
    } catch (notifErr) {
      console.error("Notification send failed (non-blocking):", notifErr);
    }

    return new Response(JSON.stringify({ video: ref }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-video error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function uploadVideo(
  admin: ReturnType<typeof createClient>,
  userId: string,
  prompt: string,
  videoUrl: string
): Promise<string> {
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error("Failed to download generated video");

  const videoBytes = new Uint8Array(await videoRes.arrayBuffer());
  const path = `${userId}/generated/vid-${Date.now()}.mp4`;
  const { error: uploadError } = await admin.storage
    .from("chat-files")
    .upload(path, videoBytes, { contentType: "video/mp4", upsert: false });

  if (uploadError) throw uploadError;

  const ref = `storage:chat-files/${path}`;
  console.log("Video generated and uploaded:", ref);

  if (userId !== "anonymous") {
    await admin.from("generated_videos").insert({
      user_id: userId,
      prompt,
      video_url: ref,
    });
  }

  return ref;
}

async function imageToMotionFallback(
  generationPrompt: string,
  apiKey: string,
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  userPromptForDb: string
) {
  console.log("Using image → motion SVD fallback");

  const imgRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      prompt: generationPrompt,
      modelId: "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3",
      width: 832,
      height: 480,
      num_images: 1,
      alchemy: true,
    }),
  });

  if (!imgRes.ok) {
    const errText = await imgRes.text();
    throw new Error(`Base image generation failed (${imgRes.status}): ${errText}`);
  }

  const imgData = await imgRes.json();
  const genId = imgData.sdGenerationJob?.generationId;
  if (!genId) throw new Error("No generation ID for base image");

  let imageId = "";
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollRes = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${genId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!pollRes.ok) continue;
    const pollData = await pollRes.json();
    const gen = pollData.generations_by_pk;
    if (gen?.status === "COMPLETE" && gen.generated_images?.[0]) {
      imageId = gen.generated_images[0].id;
      break;
    }
    if (gen?.status === "FAILED") throw new Error("Base image generation failed");
  }

  if (!imageId) throw new Error("Base image generation timed out");

  const motionRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations-motion-svd", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      imageId,
      isPublic: false,
      motionStrength: 5,
    }),
  });

  if (!motionRes.ok) {
    const errText = await motionRes.text();
    throw new Error(`Motion SVD failed (${motionRes.status}): ${errText}`);
  }

  const motionData = await motionRes.json();
  const motionGenId = motionData.motionSvdGenerationJob?.generationId;
  if (!motionGenId) throw new Error("No motion generation ID");

  let videoUrl = "";
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollRes = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${motionGenId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!pollRes.ok) continue;
    const pollData = await pollRes.json();
    const gen = pollData.generations_by_pk;
    if (gen?.status === "COMPLETE") {
      const video = gen.generated_images?.find((img: any) => img.motionMP4URL);
      if (video?.motionMP4URL) {
        videoUrl = video.motionMP4URL;
        break;
      }
    }
    if (gen?.status === "FAILED") throw new Error("Video generation failed");
  }

  if (!videoUrl) throw new Error("Video generation timed out");

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const ref = await uploadVideo(admin, userId, userPromptForDb, videoUrl);

  return new Response(JSON.stringify({ video: ref }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendGenerationNotification(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  type: "image" | "video",
  prompt: string
) {
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
