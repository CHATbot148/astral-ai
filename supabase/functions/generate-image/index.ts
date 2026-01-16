import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const { prompt, imageDataUrl } = await req.json();
    if (!prompt && !imageDataUrl) throw new Error("Prompt or imageDataUrl is required");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const STABILITY_API_KEY = Deno.env.get("STABILITY_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) throw new Error("Backend is not configured");

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    // Resolve user id if available (not mandatory)
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

    // If imageDataUrl is provided (from Puter.js), just upload it
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

    // Try Stability AI first (most reliable)
    if (STABILITY_API_KEY) {
      console.log("Attempting Stability AI generation...");
      try {
        const formData = new FormData();
        formData.append("prompt", prompt);
        formData.append("output_format", "png");
        formData.append("aspect_ratio", "1:1");

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
            console.error("Stability upload error:", upErr);
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
        }
      } catch (stabErr) {
        console.error("Stability AI exception:", stabErr);
      }
    }

    // Fallback to Lovable AI Gateway (Gemini)
    if (LOVABLE_API_KEY) {
      console.log("Attempting Lovable AI Gateway generation...");
      const gatewayResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image-preview",
          messages: [{ role: "user", content: `Generate an image: ${prompt}` }],
          modalities: ["image", "text"],
        }),
      });

      if (!gatewayResp.ok) {
        const t = await gatewayResp.text();
        console.error("AI gateway image error:", gatewayResp.status, t);
        if (gatewayResp.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (gatewayResp.status === 402) {
          return new Response(JSON.stringify({ error: "AI credits required. Please add credits." }), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error("Image generation failed");
      }

      const data = await gatewayResp.json();
      const generatedImageDataUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url as string | undefined;
      if (!generatedImageDataUrl) {
        console.error("No image in response:", JSON.stringify(data));
        throw new Error("No image was generated");
      }

      // Upload to storage
      const { mime, bytes } = parseDataUrl(generatedImageDataUrl);
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
      console.log("Lovable AI generation successful:", storageRef);
      return new Response(JSON.stringify({ image: storageRef }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("No image generation API configured. Please add STABILITY_API_KEY or LOVABLE_API_KEY.");
  } catch (e) {
    console.error("generate-image error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
