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

    // First generate a base image, then animate it
    const createRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LEONARDO_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        prompt,
        width: 832,
        height: 480,
        num_images: 1,
        alchemy: true,
        promptEnhance: true,
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error("Leonardo image create error:", createRes.status, errText);
      throw new Error(`Video generation failed (${createRes.status}). Please try again.`);
    }

    const createData = await createRes.json();
    const generationId = createData.sdGenerationJob?.generationId;
    if (!generationId) {
      console.error("No generationId:", JSON.stringify(createData));
      throw new Error("Failed to start video generation");
    }

    console.log(`Base image generation started, ID: ${generationId}`);

    // Poll for base image completion
    let baseImageId = "";
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`, {
        headers: { Authorization: `Bearer ${LEONARDO_API_KEY}`, Accept: "application/json" },
      });

      if (pollRes.ok) {
        const pollData = await pollRes.json();
        const gen = pollData.generations_by_pk;
        if (gen?.status === "COMPLETE" && gen.generated_images?.[0]) {
          baseImageId = gen.generated_images[0].id;
          console.log("Base image ready, ID:", baseImageId);
          break;
        }
        if (gen?.status === "FAILED") throw new Error("Base image generation failed");
      }
    }

    if (!baseImageId) throw new Error("Base image generation timed out");

    // Now create motion video from the base image
    const motionRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations-motion-svd", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LEONARDO_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        generatedImageId: baseImageId,
        isPublic: false,
        motionStrength: 5,
      }),
    });

    if (!motionRes.ok) {
      const errText = await motionRes.text();
      console.error("Leonardo motion error:", motionRes.status, errText);
      throw new Error("Video animation failed. Please try again.");
    }

    const motionData = await motionRes.json();
    const motionGenId = motionData.motionSvdGenerationJob?.generationId;
    if (!motionGenId) throw new Error("Failed to start video animation");

    console.log(`Motion generation started, ID: ${motionGenId}`);

    // Poll for video completion (up to 120 seconds)
    let videoUrl = "";
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${motionGenId}`, {
        headers: { Authorization: `Bearer ${LEONARDO_API_KEY}`, Accept: "application/json" },
      });

      if (pollRes.ok) {
        const pollData = await pollRes.json();
        const gen = pollData.generations_by_pk;
        if (gen?.status === "COMPLETE") {
          const video = gen.generated_images?.find((img: any) => img.motionMP4URL);
          if (video?.motionMP4URL) {
            videoUrl = video.motionMP4URL;
            break;
          }
        }
        if (gen?.status === "FAILED") throw new Error("Video generation failed. Please try again.");
      }
    }

    if (!videoUrl) throw new Error("Video generation timed out. Please try again.");

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
