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
      referenceImageUrl,
      style = "photoreal",
    } = body;

    if (!prompt && !imageDataUrl) throw new Error("Prompt or imageDataUrl is required");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

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

    // If imageDataUrl is provided (from client-side fallback), just upload it
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

    console.log(`Generating image: "${enhancedPrompt}"`);

    // Use Lovable AI Gateway with Gemini Flash Image model
    if (LOVABLE_API_KEY) {
      console.log("Using Lovable AI Gateway (Gemini Flash Image)...");
      
      // Build message content - support for image-to-image if reference provided
      const messageContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
      messageContent.push({ type: "text", text: enhancedPrompt });
      
      if (referenceImageUrl) {
        console.log("Image-to-image mode with reference");
        messageContent.push({
          type: "image_url",
          image_url: { url: referenceImageUrl }
        });
      }

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [
            {
              role: "user",
              content: messageContent,
            },
          ],
          modalities: ["image", "text"],
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error("Lovable AI Gateway error:", aiResponse.status, errText);
        throw new Error(`Image generation failed: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      const generatedImageUrl = aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

      if (!generatedImageUrl) {
        console.error("No image in response:", JSON.stringify(aiData).slice(0, 500));
        throw new Error("No image was generated");
      }

      // The image is base64 encoded, upload it to storage
      const { mime, bytes } = parseDataUrl(generatedImageUrl);
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
      console.log("Generation successful:", storageRef);
      return new Response(JSON.stringify({ image: storageRef }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Image generation is not configured. Please add LOVABLE_API_KEY.");
  } catch (e) {
    console.error("generate-image error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});