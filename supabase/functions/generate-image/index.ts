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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, imageDataUrl, referenceImageUrl, style = "photoreal", aspectRatio = "1:1" } = await req.json();
    if (!prompt && !imageDataUrl) throw new Error("Prompt or imageDataUrl is required");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) throw new Error("Backend is not configured");
    if (!LOVABLE_API_KEY) throw new Error("Image generation is not configured");

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

    // Daily limit
    if (userId !== "anonymous") {
      const dailyLimit = userEmail === CEO_EMAIL ? DAILY_LIMIT_CEO : DAILY_LIMIT_REGULAR;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const { count } = await admin
        .from("generated_images")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", today.toISOString());

      if ((count || 0) >= dailyLimit) {
        return new Response(JSON.stringify({
          error: "Daily image generation limit reached",
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
    console.log(`Generating image with Gemini: "${enhancedPrompt}"`);

    // Build messages for Gemini image generation
    const messages: any[] = [];
    if (referenceImageUrl) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: `Create a variation of this image based on: ${enhancedPrompt}` },
          { type: "image_url", image_url: { url: referenceImageUrl } },
        ],
      });
    } else {
      messages.push({ role: "user", content: `Generate an image: ${enhancedPrompt}` });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages,
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini image gen error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("Image generation failed. Please try again.");
    }

    const data = await response.json();
    const generatedImageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!generatedImageUrl) {
      console.error("No image in Gemini response:", JSON.stringify(data).slice(0, 500));
      throw new Error("No image was generated. Try a different prompt.");
    }

    const { mime, bytes } = parseDataUrl(generatedImageUrl);
    const ref = await uploadAndSave(admin, userId, prompt, style, aspectRatio, bytes, mime);

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
