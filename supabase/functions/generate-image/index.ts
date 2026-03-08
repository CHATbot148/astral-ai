import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
const IMAGE_MODELS: Record<string, { provider: "lovable" | "leonardo"; lovableModel?: string; leonardoId?: string }> = {
  nano_banana_2: { provider: "lovable", lovableModel: "google/gemini-2.5-flash-image" },
  seedream_4_5: { provider: "leonardo", leonardoId: "b24e16ff-06e3-43eb-8d33-4c419f36e1b7" },
  lucid_origin: { provider: "leonardo", leonardoId: "5c232a9e-9061-4777-980a-ddc8e65647c6" },
  flux_2_pro: { provider: "leonardo", leonardoId: "aa77f04e-3eec-4034-9c07-d0f619684628" },
  phoenix: { provider: "leonardo", leonardoId: "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3" },
};

const DEFAULT_MODEL = "nano_banana_2";

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime: match[1], bytes };
}

async function uploadAndSave(
  admin: any, userId: string, prompt: string, style: string,
  aspectRatio: string, imgBytes: Uint8Array, mime: string
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
      user_id: userId, prompt, image_url: ref, style, aspect_ratio: aspectRatio,
    });
  }
  return ref;
}

async function generateWithLovable(prompt: string, model: string, referenceImageUrl?: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;

  // Build message content - support image-to-image via multimodal input
  let messageContent: any;
  if (referenceImageUrl) {
    // Resolve reference image to a usable URL
    let imageUrl = referenceImageUrl;
    if (referenceImageUrl.startsWith("storage:")) {
      // Resolve storage ref to signed URL
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (SUPABASE_URL && SERVICE_ROLE_KEY) {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
        const raw = referenceImageUrl.slice("storage:".length);
        const slashIdx = raw.indexOf("/");
        const bucket = raw.slice(0, slashIdx);
        const path = raw.slice(slashIdx + 1);
        const { data: signed } = await admin.storage.from(bucket).createSignedUrl(path, 3600);
        if (signed?.signedUrl) imageUrl = signed.signedUrl;
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, imageDataUrl, referenceImageUrl, style = "photoreal", aspectRatio = "1:1", modelId, appInForeground } = await req.json();
    if (!prompt && !imageDataUrl) throw new Error("Prompt or imageDataUrl is required");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const LEONARDO_API_KEY = Deno.env.get("LEONARDO_API_KEY");
    const STABILITY_API_KEY = Deno.env.get("STABILITY_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) throw new Error("Backend is not configured");
    if (!LEONARDO_API_KEY && !STABILITY_API_KEY && !LOVABLE_API_KEY) throw new Error("Image generation API key not configured");

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
      if (data?.user?.id) { userId = data.user.id; userEmail = data.user.email || ""; }
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

      tier = (sub && sub.status === "active" && (!sub.expires_at || new Date(sub.expires_at) > new Date()))
        ? sub.tier : "free";

      const tierLimits: Record<string, number> = {
        free: 5, basic: 10, pro: 25, ultimate: 999999,
      };

      const dailyLimit = userEmail === CEO_EMAIL ? 20 : (tierLimits[tier] || 5);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const { count } = await admin
        .from("generated_images")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", today.toISOString());

      if ((count || 0) >= dailyLimit) {
        return new Response(JSON.stringify({
          error: `Daily image limit reached (${dailyLimit}/day). Upgrade your plan for more.`,
          limit_reached: true, remaining: 0, limit: dailyLimit,
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
    const selectedModelKey = canSelectModel && modelId && IMAGE_MODELS[modelId]
      ? modelId
      : DEFAULT_MODEL;
    const selectedModel = IMAGE_MODELS[selectedModelKey] || IMAGE_MODELS[DEFAULT_MODEL];

    let imgBytes: Uint8Array | null = null;
    let imgMime = "image/png";

    // Handle image-to-image reference via Leonardo init-image
    let initImageId: string | undefined;
    if (referenceImageUrl && LEONARDO_API_KEY) {
      try {
        // Step 1: Get presigned upload URL
        const initRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/init-image", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LEONARDO_API_KEY}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ extension: "jpg" }),
        });
        if (initRes.ok) {
          const initData = await initRes.json();
          const uploadUrl = initData?.uploadInitImage?.url;
          const initId = initData?.uploadInitImage?.id;
          if (uploadUrl && initId) {
            // Step 2: Upload the reference image bytes
            let refBytes: Uint8Array;
            if (referenceImageUrl.startsWith("data:")) {
              const parsed = parseDataUrl(referenceImageUrl);
              refBytes = parsed.bytes;
            } else {
              const refRes = await fetch(referenceImageUrl);
              refBytes = new Uint8Array(await refRes.arrayBuffer());
            }
            const uploadRes = await fetch(uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": "image/jpeg" },
              body: refBytes,
            });
            if (uploadRes.ok) {
              initImageId = initId;
              console.log("Reference image uploaded, initImageId:", initImageId);
            }
          }
        }
      } catch (e) {
        console.error("Init image upload failed (non-blocking):", e);
      }
    }

    // ===== PRIMARY: selected provider =====
    if (selectedModel.provider === "lovable" && selectedModel.lovableModel) {
      console.log(`[PRIMARY] Lovable AI (${selectedModel.lovableModel}): "${enhancedPrompt}"`);
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

    if (!imgBytes && LEONARDO_API_KEY) {
      const leonardoModelId = selectedModel.leonardoId || IMAGE_MODELS.phoenix.leonardoId!;
      console.log(`[FALLBACK] Leonardo AI (model: ${leonardoModelId}): "${enhancedPrompt}"`);
      try {
        const createRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LEONARDO_API_KEY}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            prompt: enhancedPrompt,
            modelId: leonardoModelId,
            width: dims.width,
            height: dims.height,
            num_images: 1,
            alchemy: true,
            photoReal: style === "photoreal",
            presetStyle: style === "cinematic" ? "CINEMATIC" : style === "anime" ? "ANIME" : "NONE",
            ...(initImageId ? { init_image_id: initImageId, isInitImage: true } : {}),
          }),
        });

        if (!createRes.ok) {
          const errText = await createRes.text();
          console.error("Leonardo create error:", createRes.status, errText);
          throw new Error(`Leonardo create failed: ${createRes.status}`);
        }

        const createData = await createRes.json();
        const generationId = createData.sdGenerationJob?.generationId;
        if (!generationId) throw new Error("No generation ID from Leonardo");

        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 3000));
          const pollRes = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`, {
            headers: { Authorization: `Bearer ${LEONARDO_API_KEY}`, Accept: "application/json" },
          });
          if (!pollRes.ok) continue;
          const pollData = await pollRes.json();
          const gen = pollData.generations_by_pk;
          if (gen?.status === "COMPLETE" && gen.generated_images?.[0]?.url) {
            const dlRes = await fetch(gen.generated_images[0].url);
            if (dlRes.ok) {
              imgBytes = new Uint8Array(await dlRes.arrayBuffer());
              imgMime = "image/png";
            }
            break;
          }
          if (gen?.status === "FAILED") throw new Error("Leonardo generation failed");
        }
      } catch (e) {
        console.error("Leonardo AI failed:", e);
      }
    }

    // ===== FALLBACK 1: Stability AI =====
    if (!imgBytes && STABILITY_API_KEY) {
      console.log(`[FALLBACK] Stability AI: "${enhancedPrompt}"`);
      try {
        const formData = new FormData();
        formData.append("prompt", enhancedPrompt);
        formData.append("output_format", "png");

        const response = await fetch("https://api.stability.ai/v2beta/stable-image/generate/sd3", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${STABILITY_API_KEY}`,
            Accept: "image/*",
          },
          body: formData,
        });

        if (response.ok) {
          imgBytes = new Uint8Array(await response.arrayBuffer());
          imgMime = "image/png";
        } else {
          const errText = await response.text();
          console.error("Stability AI error:", response.status, errText);
        }
      } catch (e) {
        console.error("Stability AI failed:", e);
      }
    }

    // ===== FALLBACK 2: Pollinations.ai (free, no key) =====
    if (!imgBytes) {
      console.log("[FALLBACK] Pollinations.ai");
      try {
        const polUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=${dims.width}&height=${dims.height}&nologo=true`;
        const polRes = await fetch(polUrl);
        if (polRes.ok) {
          imgBytes = new Uint8Array(await polRes.arrayBuffer());
          imgMime = "image/jpeg";
        }
      } catch (e) {
        console.error("Pollinations failed:", e);
      }
    }

    if (!imgBytes) throw new Error("All image generation providers failed. Please try again.");

    const ref = await uploadAndSave(admin, userId, prompt, style, aspectRatio, imgBytes, imgMime);

    // Send background notification only when app is NOT in foreground
    if (userId !== "anonymous" && !appInForeground) {
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
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function sendGenerationNotification(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  type: "image" | "video",
  prompt: string,
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
