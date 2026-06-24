import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STYLE_PROMPTS: Record<string, string> = {
  photoreal: "ultra realistic photograph, 8k, high detail, professional photography",
  cinematic: "cinematic shot, dramatic lighting, film grain, movie still, epic composition",
  anime: "anime style, detailed illustration, vibrant colors, Studio Ghibli inspired",
  sketch: "pencil sketch, hand drawn, detailed line art, artistic illustration",
  none: "",
};

const CEO_EMAIL = "khaleelktn@gmail.com";

const ASPECT_RATIO_MAP: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1344, height: 768 },
  "9:16": { width: 768, height: 1344 },
  "4:3": { width: 1152, height: 896 },
  "3:4": { width: 896, height: 1152 },
};

// Provider model mapping
const IMAGE_MODELS: Record<
  string,
  { provider: "lovable" | "leonardo"; lovableModel?: string; leonardoId?: string }
> = {
  nano_banana_2: { provider: "lovable", lovableModel: "google/gemini-3.1-flash-image" },
  seedream_4_5: { provider: "leonardo", leonardoId: "b24e16ff-06e3-43eb-8d33-4c419f36e1b7" },
  lucid_origin: { provider: "leonardo", leonardoId: "5c232a9e-9061-4777-980a-ddc8e65647c6" },
  flux_2_pro: { provider: "leonardo", leonardoId: "aa77f04e-3eec-4034-9c07-d0f619684628" },
  phoenix: { provider: "leonardo", leonardoId: "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3" },
};

const DEFAULT_MODEL = "nano_banana_2";
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

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: messageContent }],
      modalities: ["image", "text"],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Lovable AI image generation failed:", response.status, errText);
    return null;
  }

  const data = await response.json();
  const imageDataUrl = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return null;
  }

  const parsed = parseDataUrl(imageDataUrl);
  return { bytes: parsed.bytes, mime: parsed.mime || "image/png" };
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

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
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
    console.error("Gemini Studio image edit failed:", res.status, errText);
    return null;
  }

  const data = await res.json();
  const candidateParts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(candidateParts)) return null;

  for (const part of candidateParts) {
    const inline = part?.inlineData || part?.inline_data;
    if (inline?.data && (inline?.mimeType || inline?.mime_type)) {
      const outMime = inline.mimeType || inline.mime_type || "image/png";
      const outBytes = base64ToBytes(String(inline.data));
      return { bytes: outBytes, mime: outMime };
    }
  }

  return null;
}

async function generateWithGeminiStudioTextToImage(
  prompt: string
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) return null;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
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
    console.error("Gemini Studio text-to-image failed:", res.status, errText);
    return null;
  }

  const data = await res.json();
  const candidateParts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(candidateParts)) return null;

  for (const part of candidateParts) {
    const inline = part?.inlineData || part?.inline_data;
    if (inline?.data && (inline?.mimeType || inline?.mime_type)) {
      const outMime = inline.mimeType || inline.mime_type || "image/png";
      const outBytes = base64ToBytes(String(inline.data));
      return { bytes: outBytes, mime: outMime };
    }
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
    if (!LOVABLE_API_KEY) {
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
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { count } = await admin
        .from("generated_images")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", today.toISOString());

      if ((count || 0) >= dailyLimit) {
        return new Response(
          JSON.stringify({
            error: `Daily image limit reached (${dailyLimit}/day). Upgrade your plan for more.`,
            limit_reached: true,
            remaining: 0,
            limit: dailyLimit,
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
    const enhancedPrompt = stylePrompt ? `${prompt}, ${stylePrompt}` : prompt;
    const dims = ASPECT_RATIO_MAP[aspectRatio] || ASPECT_RATIO_MAP["1:1"];

    // Resolve model: allow Pro/Ultimate to pick, otherwise use Nano Banana 2 by default
    const canSelectModel = tier === "pro" || tier === "ultimate" || userEmail === CEO_EMAIL;
    const selectedModelKey = canSelectModel && modelId && IMAGE_MODELS[modelId] ? modelId : DEFAULT_MODEL;
    const selectedModel = IMAGE_MODELS[selectedModelKey] || IMAGE_MODELS[DEFAULT_MODEL];

    let imgBytes: Uint8Array | null = null;
    let imgMime = "image/png";

    // Image generation is locked to Nano Banana 2 only while other media credits are paused.
    if (referenceImageUrl) {
      console.log(`[PRIMARY] Nano Banana 2 reference generation: "${enhancedPrompt}"`);
      try {
        const generated = await generateWithLovable(enhancedPrompt, selectedModel.lovableModel!, referenceImageUrl);
        if (generated) {
          imgBytes = generated.bytes;
          imgMime = generated.mime;
        }
      } catch (e) {
        console.error("Nano Banana 2 reference generation failed:", e);
      }
    }

    if (!imgBytes && !referenceImageUrl && selectedModel.provider === "lovable" && selectedModel.lovableModel) {
      console.log(`[PRIMARY] Nano Banana 2 (${selectedModel.lovableModel}): "${enhancedPrompt}"`);
      try {
        const generated = await generateWithLovable(enhancedPrompt, selectedModel.lovableModel);
        if (generated) {
          imgBytes = generated.bytes;
          imgMime = generated.mime;
        }
      } catch (e) {
        console.error("Lovable AI failed:", e);
      }
    }

    if (!imgBytes) throw new Error("Nano Banana 2 image generation failed. Please try again.");

    const ref = await uploadAndSave(admin, userId, prompt, style, aspectRatio, imgBytes, imgMime);

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
