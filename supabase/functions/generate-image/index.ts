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
    const { prompt } = await req.json();
    if (!prompt) throw new Error("Prompt is required");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) throw new Error("Backend is not configured");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

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
      return new Response(JSON.stringify({ error: "Image generation failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await gatewayResp.json();
    const imageDataUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url as string | undefined;
    if (!imageDataUrl) {
      console.error("No image in response:", JSON.stringify(data));
      throw new Error("No image was generated");
    }

    // Upload to storage so we don't store giant base64 strings in DB
    const { mime, bytes } = parseDataUrl(imageDataUrl);
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const path = `generated/${userId}/img-${Date.now()}.${ext}`;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
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
  } catch (e) {
    console.error("generate-image error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
