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

// CEO email for higher limits
const CEO_EMAIL = "khaleelktn@gmail.com";
const DAILY_LIMIT_REGULAR = 5;
const DAILY_LIMIT_CEO = 20;

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
      aspectRatio = "1:1",
    } = body;

    if (!prompt && !imageDataUrl) throw new Error("Prompt or imageDataUrl is required");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error("Backend is not configured");
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    // Resolve user id and email if available
    let userId = "anonymous";
    let userEmail = "";
    if (jwt) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      });
      const { data } = await userClient.auth.getUser();
      if (data?.user?.id) {
        userId = data.user.id;
        userEmail = data.user.email || "";
      }
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Check daily limit (skip for anonymous)
    if (userId !== "anonymous") {
      const dailyLimit = userEmail === CEO_EMAIL ? DAILY_LIMIT_CEO : DAILY_LIMIT_REGULAR;
      
      // Get today's start
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const { count, error: countErr } = await admin
        .from("generated_images")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", today.toISOString());
      
      if (countErr) {
        console.error("Count error:", countErr);
      }
      
      const todayCount = count || 0;
      
      if (todayCount >= dailyLimit) {
        return new Response(JSON.stringify({ 
          error: "You have used up your daily image generations", 
          limit_reached: true,
          remaining: 0,
          limit: dailyLimit,
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

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
      
      // Save to generated_images table
      if (userId !== "anonymous") {
        await admin.from("generated_images").insert({
          user_id: userId,
          prompt: prompt || "Uploaded image",
          image_url: storageRef,
          style,
          aspect_ratio: aspectRatio,
        });
      }
      
      return new Response(JSON.stringify({ image: storageRef }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build enhanced prompt with style
    const stylePrompt = STYLE_PROMPTS[style] || "";
    const enhancedPrompt = stylePrompt ? `${prompt}, ${stylePrompt}` : prompt;

    console.log(`Generating image with Pollinations.ai: "${enhancedPrompt}"`);

    // Use Pollinations.ai as the primary image generator
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?nologo=true&width=1024&height=1024`;
    
    const pollResponse = await fetch(pollinationsUrl);
    
    if (!pollResponse.ok) {
      console.error("Pollinations.ai error:", pollResponse.status);
      throw new Error("Image generation failed. Please try again.");
    }

    const imageBlob = await pollResponse.blob();
    const arrayBuffer = await imageBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    const mime = imageBlob.type || "image/jpeg";
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
    console.log("Pollinations generation successful:", storageRef);
    
    // Save to generated_images table
    if (userId !== "anonymous") {
      await admin.from("generated_images").insert({
        user_id: userId,
        prompt,
        image_url: storageRef,
        style,
        aspect_ratio: aspectRatio,
      });
    }
    
    return new Response(JSON.stringify({ image: storageRef }), {
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
