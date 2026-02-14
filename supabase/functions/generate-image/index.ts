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
const DAILY_LIMIT_REGULAR = 5;
const DAILY_LIMIT_CEO = 20;

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime: match[1], bytes };
}

async function uploadAndSave(admin: any, userId: string, prompt: string, style: string, aspectRatio: string, imgBytes: Uint8Array, mime: string) {
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const path = `${userId}/generated/img-${Date.now()}.${ext}`;
  const { error } = await admin.storage.from("chat-files").upload(path, imgBytes, { contentType: mime, upsert: false });
  if (error) throw error;
  const ref = `storage:chat-files/${path}`;
  if (userId !== "anonymous") {
    await admin.from("generated_images").insert({ user_id: userId, prompt, image_url: ref, style, aspect_ratio: aspectRatio });
  }
  return ref;
}

/**
 * Upload init image to Leonardo AI for image-to-image.
 * 1. POST /init-image → get presigned URL + image ID
 * 2. PUT image bytes to presigned URL
 * 3. Return the init image ID
 */
async function uploadInitImageToLeonardo(apiKey: string, imageBytes: Uint8Array, mime: string): Promise<string> {
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";

  // Step 1: Get presigned URL
  const initRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/init-image", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ extension: ext }),
  });

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Leonardo init-image failed: ${initRes.status} ${errText}`);
  }

  const initData = await initRes.json();
  const uploadData = initData.uploadInitImage;
  if (!uploadData?.url || !uploadData?.id) {
    throw new Error("Leonardo init-image returned no URL or ID");
  }

  // Step 2: Upload to presigned URL using the fields
  const fields = typeof uploadData.fields === "string" ? JSON.parse(uploadData.fields) : uploadData.fields;
  const formData = new FormData();
  if (fields && typeof fields === "object") {
    for (const [key, value] of Object.entries(fields)) {
      formData.append(key, value as string);
    }
  }
  const blob = new Blob([imageBytes], { type: mime });
  formData.append("file", blob, `image.${ext}`);

  const uploadRes = await fetch(uploadData.url, {
    method: "POST",
    body: formData,
  });

  if (!uploadRes.ok && uploadRes.status !== 204) {
    throw new Error(`Leonardo image upload failed: ${uploadRes.status}`);
  }

  console.log(`Leonardo init image uploaded, ID: ${uploadData.id}`);
  return uploadData.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, imageDataUrl, referenceImageUrl, style = "photoreal", aspectRatio = "1:1" } = await req.json();
    if (!prompt && !imageDataUrl) throw new Error("Prompt or imageDataUrl is required");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) throw new Error("Backend is not configured");

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    let userId = "anonymous";
    let userEmail = "";
    if (jwt) {
      const uc = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
      const { data } = await uc.auth.getUser();
      if (data?.user?.id) { userId = data.user.id; userEmail = data.user.email || ""; }
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Check daily limit
    if (userId !== "anonymous") {
      const dailyLimit = userEmail === CEO_EMAIL ? DAILY_LIMIT_CEO : DAILY_LIMIT_REGULAR;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const { count } = await admin.from("generated_images").select("*", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", today.toISOString());
      if ((count || 0) >= dailyLimit) {
        return new Response(JSON.stringify({ error: "You have used up your daily image generations", limit_reached: true, remaining: 0, limit: dailyLimit }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Handle client-side image upload (no AI generation)
    if (imageDataUrl && !prompt) {
      const { mime, bytes } = parseDataUrl(imageDataUrl);
      const ref = await uploadAndSave(admin, userId, "Uploaded image", style, aspectRatio, bytes, mime);
      return new Response(JSON.stringify({ image: ref }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const stylePrompt = STYLE_PROMPTS[style] || "";
    const enhancedPrompt = stylePrompt ? `${prompt}, ${stylePrompt}` : prompt;
    console.log(`Generating image: "${enhancedPrompt}"`);

    // Parse reference image if provided
    let refImageBytes: Uint8Array | null = null;
    let refImageMime = "image/png";
    if (referenceImageUrl) {
      try {
        const parsed = parseDataUrl(referenceImageUrl);
        refImageBytes = parsed.bytes;
        refImageMime = parsed.mime;
        console.log("Reference image provided for image-to-image");
      } catch {
        console.warn("Failed to parse reference image, proceeding without it");
      }
    }

    // === PRIMARY: Leonardo AI ===
    const LEONARDO_API_KEY = Deno.env.get("LEONARDO_API_KEY");
    if (LEONARDO_API_KEY) {
      try {
        console.log("Trying Leonardo AI...");

        const generationBody: Record<string, any> = {
          prompt: enhancedPrompt,
          modelId: "6b645e3a-d64f-4341-a6d8-7a3690fbf042",
          width: 1024, height: 1024, num_images: 1,
        };

        // Image-to-image: upload init image first
        if (refImageBytes) {
          try {
            const initImageId = await uploadInitImageToLeonardo(LEONARDO_API_KEY, refImageBytes, refImageMime);
            generationBody.init_image_id = initImageId;
            generationBody.init_strength = 0.4; // Balance between reference and prompt
            console.log(`Using init image ID: ${initImageId}`);
          } catch (uploadErr) {
            console.warn("Failed to upload init image to Leonardo:", uploadErr);
            // Continue without reference image
          }
        }

        const createRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${LEONARDO_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(generationBody),
        });

        if (createRes.ok) {
          const createData = await createRes.json();
          const generationId = createData.sdGenerationJob?.generationId;
          if (generationId) {
            let imageUrl = "";
            for (let i = 0; i < 30; i++) {
              await new Promise(r => setTimeout(r, 2000));
              const pollRes = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`, {
                headers: { Authorization: `Bearer ${LEONARDO_API_KEY}`, Accept: "application/json" },
              });
              if (pollRes.ok) {
                const pollData = await pollRes.json();
                const gen = pollData.generations_by_pk;
                if (gen?.status === "COMPLETE" && gen.generated_images?.length > 0) { imageUrl = gen.generated_images[0].url; break; }
                if (gen?.status === "FAILED") { console.warn("Leonardo generation failed"); break; }
              }
            }
            if (imageUrl) {
              const imgRes = await fetch(imageUrl);
              if (imgRes.ok) {
                const imgBytes = new Uint8Array(await (await imgRes.blob()).arrayBuffer());
                const ref = await uploadAndSave(admin, userId, prompt, style, aspectRatio, imgBytes, "image/png");
                return new Response(JSON.stringify({ image: ref }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
              }
            }
          }
        } else {
          console.warn("Leonardo AI failed:", createRes.status, await createRes.text());
        }
      } catch (err) {
        console.warn("Leonardo AI error:", err);
      }
    }

    // === FALLBACK 1: Stability AI ===
    const STABILITY_API_KEY = Deno.env.get("STABILITY_API_KEY");
    if (STABILITY_API_KEY) {
      console.log("Falling back to Stability AI...");
      try {
        const formData = new FormData();
        formData.append("prompt", enhancedPrompt);
        formData.append("output_format", "png");

        // Add reference image for Stability AI image-to-image
        if (refImageBytes) {
          const blob = new Blob([refImageBytes], { type: refImageMime });
          formData.append("image", blob, "reference.png");
          formData.append("strength", "0.6");
          formData.append("mode", "image-to-image");
        }

        const stabRes = await fetch("https://api.stability.ai/v2beta/stable-image/generate/sd3", {
          method: "POST",
          headers: { Authorization: `Bearer ${STABILITY_API_KEY}`, Accept: "image/*" },
          body: formData,
        });
        if (stabRes.ok) {
          const imgBytes = new Uint8Array(await stabRes.arrayBuffer());
          const ref = await uploadAndSave(admin, userId, prompt, style, aspectRatio, imgBytes, "image/png");
          return new Response(JSON.stringify({ image: ref }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        console.warn("Stability AI failed:", stabRes.status);
      } catch (stabErr) {
        console.warn("Stability AI error:", stabErr);
      }
    }

    // === FALLBACK 2: Pollinations.ai (free, no key needed) ===
    console.log("Falling back to Pollinations.ai...");
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?nologo=true&width=1024&height=1024&model=flux`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const pollRes = await fetch(pollinationsUrl);
        if (pollRes.ok) {
          const imgBytes = new Uint8Array(await (await pollRes.blob()).arrayBuffer());
          const ref = await uploadAndSave(admin, userId, prompt, style, aspectRatio, imgBytes, "image/jpeg");
          return new Response(JSON.stringify({ image: ref }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        console.warn(`Pollinations attempt ${attempt}/3 failed: ${pollRes.status}`);
      } catch (e2) {
        console.warn(`Pollinations attempt ${attempt}/3 error:`, e2);
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000));
    }

    throw new Error("All image generation providers are temporarily unavailable. Please try again later.");
  } catch (e) {
    console.error("generate-image error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
