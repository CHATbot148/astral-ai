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

    console.log(`Generating video with Leonardo text-to-video: "${prompt}"`);

    // Use Leonardo's direct text-to-video endpoint (Motion 2.0)
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
        isPublic: false,
        frameInterpolation: true,
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error("Leonardo text-to-video error:", createRes.status, errText);
      
      // If text-to-video not available, fallback to image → motion SVD
      console.log("Falling back to image → motion SVD approach...");
      return await imageToMotionFallback(req, prompt, LEONARDO_API_KEY, SUPABASE_URL, SERVICE_ROLE_KEY, userId);
    }

    const createData = await createRes.json();
    const generationId = createData.motionVideoGenerationJob?.generationId
      || createData.textToVideoGenerationJob?.generationId
      || createData.generationId;

    if (!generationId) {
      console.error("No generationId from text-to-video:", JSON.stringify(createData));
      // Fallback
      return await imageToMotionFallback(req, prompt, LEONARDO_API_KEY, SUPABASE_URL, SERVICE_ROLE_KEY, userId);
    }

    console.log(`Text-to-video generation started, ID: ${generationId}`);

    // Poll for completion (up to 150 seconds)
    let videoUrl = "";
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`, {
        headers: { Authorization: `Bearer ${LEONARDO_API_KEY}`, Accept: "application/json" },
      });

      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      const gen = pollData.generations_by_pk;

      if (gen?.status === "COMPLETE") {
        // Check for video URL in generated_images
        const videoItem = gen.generated_images?.find((img: any) => img.motionMP4URL || img.url?.endsWith(".mp4"));
        if (videoItem?.motionMP4URL) {
          videoUrl = videoItem.motionMP4URL;
          break;
        }
        if (videoItem?.url) {
          videoUrl = videoItem.url;
          break;
        }
      }
      if (gen?.status === "FAILED") throw new Error("Video generation failed. Please try again.");
    }

    if (!videoUrl) throw new Error("Video generation timed out. Please try again.");

    // Download and upload to storage
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error("Failed to download generated video");

    const videoBytes = new Uint8Array(await videoRes.arrayBuffer());
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

// Fallback: generate image first, then apply motion SVD
async function imageToMotionFallback(
  _req: Request, prompt: string, apiKey: string,
  supabaseUrl: string, serviceRoleKey: string, userId: string
) {
  console.log("Using image → motion SVD fallback");

  // Step 1: Generate base image
  const imgRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      prompt,
      modelId: "6bef9f1b-29cb-40c7-b9df-32b51c1f67d3",
      width: 832,
      height: 480,
      num_images: 1,
      alchemy: true,
    }),
  });

  if (!imgRes.ok) {
    const errText = await imgRes.text();
    throw new Error(`Base image generation failed (${imgRes.status}): ${errText}`);
  }

  const imgData = await imgRes.json();
  const genId = imgData.sdGenerationJob?.generationId;
  if (!genId) throw new Error("No generation ID for base image");

  // Poll for base image
  let imageId = "";
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const pollRes = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${genId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!pollRes.ok) continue;
    const pollData = await pollRes.json();
    const gen = pollData.generations_by_pk;
    if (gen?.status === "COMPLETE" && gen.generated_images?.[0]) {
      imageId = gen.generated_images[0].id;
      break;
    }
    if (gen?.status === "FAILED") throw new Error("Base image generation failed");
  }

  if (!imageId) throw new Error("Base image generation timed out");
  console.log("Base image ready, ID:", imageId);

  // Step 2: Apply motion SVD using imageId (per Leonardo docs)
  const motionRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations-motion-svd", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      imageId: imageId,
      isPublic: false,
      motionStrength: 5,
    }),
  });

  if (!motionRes.ok) {
    const errText = await motionRes.text();
    throw new Error(`Motion SVD failed (${motionRes.status}): ${errText}`);
  }

  const motionData = await motionRes.json();
  const motionGenId = motionData.motionSvdGenerationJob?.generationId;
  if (!motionGenId) throw new Error("No motion generation ID");

  // Poll for video
  let videoUrl = "";
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const pollRes = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${motionGenId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!pollRes.ok) continue;
    const pollData = await pollRes.json();
    const gen = pollData.generations_by_pk;
    if (gen?.status === "COMPLETE") {
      const video = gen.generated_images?.find((img: any) => img.motionMP4URL);
      if (video?.motionMP4URL) { videoUrl = video.motionMP4URL; break; }
    }
    if (gen?.status === "FAILED") throw new Error("Video generation failed");
  }

  if (!videoUrl) throw new Error("Video generation timed out");

  // Upload
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const dlRes = await fetch(videoUrl);
  if (!dlRes.ok) throw new Error("Failed to download video");
  const videoBytes = new Uint8Array(await dlRes.arrayBuffer());
  const path = `${userId}/generated/vid-${Date.now()}.mp4`;
  const { error } = await admin.storage
    .from("chat-files")
    .upload(path, videoBytes, { contentType: "video/mp4", upsert: false });
  if (error) throw error;

  const ref = `storage:chat-files/${path}`;
  console.log("Video (fallback) uploaded:", ref);

  return new Response(JSON.stringify({ video: ref }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
