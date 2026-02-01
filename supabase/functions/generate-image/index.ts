import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Style presets for prompt enhancement
const STYLE_PROMPTS: Record<string, string> = {
  photoreal: "ultra realistic photograph, 8k, high detail, professional photography",
  cinematic: "cinematic shot, dramatic lighting, film grain, movie still, epic composition",
  anime: "anime style, detailed illustration, vibrant colors, Studio Ghibli inspired",
  sketch: "pencil sketch, hand drawn, detailed line art, artistic illustration",
  none: "",
};

// Aspect ratio dimensions for Stability AI
const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1344, height: 768 },
  "9:16": { width: 768, height: 1344 },
  "3:2": { width: 1216, height: 832 },
  "4:3": { width: 1152, height: 896 },
};

// Quality settings for Stability AI
const QUALITY_SETTINGS: Record<string, { steps: number; cfg_scale: number }> = {
  fast: { steps: 20, cfg_scale: 5 },
  balanced: { steps: 30, cfg_scale: 7 },
  high: { steps: 50, cfg_scale: 8 },
};

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data");
  const mime = match[1];
  const b64 = match[2];
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime, bytes };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { 
      prompt, 
      imageDataUrl,
      style = "photoreal",
      aspectRatio = "1:1",
      quality = "balanced"
    } = body;

    if (!prompt && !imageDataUrl) throw new Error("Prompt or imageDataUrl is required");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const STABILITY_API_KEY = Deno.env.get("STABILITY_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error("Backend is not configured");
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    // Resolve user id if available
    let userId = "anonymous";
    if (jwt) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      });
      const { data } = await userClient.auth.getUser();
      if (data?.user?.id) userId = data.user.id;
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // If imageDataUrl is provided (from Puter.js fallback), just upload it
    if (imageDataUrl) {
      const { mime, bytes } = parseDataUrl(imageDataUrl);
      const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
      const path = `${userId}/generated/img-${Date.now()}.${ext}`;

      const { error: upErr } = await admin.storage.from("chat-files").upload(path, bytes, {
        contentType: mime,
        upsert: false,
      });

      if (upErr) {
        console.error("Upload error:", upErr);
        throw new Error("Failed to store generated image");
      }

      const storageRef = `storage:chat-files/${path}`;
      return new Response(JSON.stringify({ image: storageRef }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build enhanced prompt with style
    const stylePrompt = STYLE_PROMPTS[style] || "";
    const enhancedPrompt = stylePrompt ? `${prompt}, ${stylePrompt}` : prompt;
    const dimensions = ASPECT_DIMENSIONS[aspectRatio] || ASPECT_DIMENSIONS["1:1"];
    const qualitySettings = QUALITY_SETTINGS[quality] || QUALITY_SETTINGS["balanced"];

    console.log(`Generating image: "${enhancedPrompt}" [${dimensions.width}x${dimensions.height}] [${quality}]`);

    // Try Stability AI (SD3 endpoint)
    if (STABILITY_API_KEY) {
      console.log("Using Stability AI SD3...");
      try {
        const formData = new FormData();
        formData.append("prompt", enhancedPrompt);
        formData.append("output_format", "png");
        formData.append("aspect_ratio", aspectRatio);

        const stabilityResp = await fetch(
          "https://api.stability.ai/v2beta/stable-image/generate/sd3",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${STABILITY_API_KEY}`,
              Accept: "image/*",
            },
            body: formData,
          }
        );

        if (stabilityResp.ok) {
          const imageBuffer = await stabilityResp.arrayBuffer();
          const bytes = new Uint8Array(imageBuffer);
          const path = `${userId}/generated/img-${Date.now()}.png`;

          const { error: upErr } = await admin.storage.from("chat-files").upload(path, bytes, {
            contentType: "image/png",
            upsert: false,
          });

          if (upErr) {
            console.error("Upload error:", upErr);
            throw new Error("Failed to store generated image");
          }

          const storageRef = `storage:chat-files/${path}`;
          console.log("Stability AI generation successful:", storageRef);
          return new Response(JSON.stringify({ image: storageRef }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } else {
          const errText = await stabilityResp.text();
          console.error("Stability AI error:", stabilityResp.status, errText);
          
          // Check for specific error types
          if (stabilityResp.status === 401) {
            throw new Error("Invalid Stability AI API key");
          }
          if (stabilityResp.status === 402) {
            throw new Error("Stability AI credits exhausted");
          }
          if (stabilityResp.status === 400 && errText.includes("content_policy")) {
            throw new Error("Content policy violation - please try a different prompt");
          }
        }
      } catch (stabErr) {
        if (stabErr instanceof Error && stabErr.message.includes("credits")) {
          throw stabErr; // Re-throw credit errors
        }
        console.error("Stability AI exception:", stabErr);
        // Fall through to alternative methods
      }
    }

    // Fallback: Try Stability AI Core (different endpoint, sometimes more available)
    if (STABILITY_API_KEY) {
      console.log("Trying Stability AI Core...");
      try {
        const formData = new FormData();
        formData.append("prompt", enhancedPrompt);
        formData.append("output_format", "png");
        formData.append("aspect_ratio", aspectRatio);

        const coreResp = await fetch(
          "https://api.stability.ai/v2beta/stable-image/generate/core",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${STABILITY_API_KEY}`,
              Accept: "image/*",
            },
            body: formData,
          }
        );

        if (coreResp.ok) {
          const imageBuffer = await coreResp.arrayBuffer();
          const bytes = new Uint8Array(imageBuffer);
          const path = `${userId}/generated/img-${Date.now()}.png`;

          const { error: upErr } = await admin.storage.from("chat-files").upload(path, bytes, {
            contentType: "image/png",
            upsert: false,
          });

          if (upErr) throw new Error("Failed to store generated image");

          const storageRef = `storage:chat-files/${path}`;
          console.log("Stability Core generation successful");
          return new Response(JSON.stringify({ image: storageRef }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (coreErr) {
        console.error("Stability Core failed:", coreErr);
      }
    }

    throw new Error("Image generation failed. Please try again.");
  } catch (e) {
    console.error("generate-image error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});