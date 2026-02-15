import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt } = await req.json();
    if (!prompt) throw new Error("Prompt is required");

    const LEONARDO_API_KEY = Deno.env.get("LEONARDO_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) throw new Error("Backend not configured");
    if (!LEONARDO_API_KEY) throw new Error("Video generation API key not configured");

    // Auth
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    let userId = "anonymous";
    if (jwt) {
      const uc = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      });
      const { data } = await uc.auth.getUser();
      if (data?.user?.id) userId = data.user.id;
    }

    console.log(`Generating video with Leonardo: "${prompt}"`);

    // Leonardo Text-to-Video API
    const createRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations-text-to-video", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LEONARDO_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        prompt,
        height: 480,
        width: 832,
        frameInterpolation: true,
        isPublic: false,
        promptEnhance: true,
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error("Leonardo video create error:", createRes.status, errText);
      throw new Error(`Video generation failed (${createRes.status}). Please try again.`);
    }

    const createData = await createRes.json();
    const generationId = createData.sdGenerationJob?.generationId;
    if (!generationId) {
      console.error("No generationId:", JSON.stringify(createData));
      throw new Error("Failed to start video generation");
    }

    console.log(`Video generation started, ID: ${generationId}`);

    // Poll for completion (up to 120 seconds)
    let videoUrl = "";
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`, {
        headers: {
          Authorization: `Bearer ${LEONARDO_API_KEY}`,
          Accept: "application/json",
        },
      });

      if (pollRes.ok) {
        const pollData = await pollRes.json();
        const gen = pollData.generations_by_pk;
        if (gen?.status === "COMPLETE") {
          // Check for video URL in generated images
          const video = gen.generated_images?.find((img: any) => img.motionMP4URL || img.url);
          if (video) {
            videoUrl = video.motionMP4URL || video.url;
            break;
          }
        }
        if (gen?.status === "FAILED") {
          console.error("Leonardo video generation failed");
          throw new Error("Video generation failed. Please try again.");
        }
      }
    }

    if (!videoUrl) {
      throw new Error("Video generation timed out. Please try again.");
    }

    // Download and upload to storage
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error("Failed to download generated video");

    const videoBytes = new Uint8Array(await (await videoRes.blob()).arrayBuffer());
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const path = `${userId}/generated/vid-${Date.now()}.mp4`;
    const { error: uploadError } = await admin.storage
      .from("chat-files")
      .upload(path, videoBytes, { contentType: "video/mp4", upsert: false });

    if (uploadError) throw uploadError;

    const ref = `storage:chat-files/${path}`;
    console.log("Video generated and uploaded:", ref);

    return new Response(JSON.stringify({ video: ref }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-video error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
