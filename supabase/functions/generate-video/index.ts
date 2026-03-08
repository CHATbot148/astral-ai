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
    let userEmail = "";
    if (jwt) {
      const uc = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      });
      const { data } = await uc.auth.getUser();
      if (data?.user?.id) userId = data.user.id;
      if (data?.user?.email) userEmail = data.user.email;
    }

    const CEO_EMAIL = "khaleelktn@gmail.com";
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    if (userId === "anonymous") {
      return new Response(JSON.stringify({
        error: "Please sign in and subscribe to generate videos.",
      }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Subscription tier check + daily video limits
    const { data: sub } = await admin
      .from("subscriptions")
      .select("tier, status, expires_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    const tier = (sub && sub.status === "active" && (!sub.expires_at || new Date(sub.expires_at) > new Date()))
      ? sub.tier : "free";

    if (tier === "free") {
      return new Response(JSON.stringify({
        error: "Video generation requires a paid plan. Please upgrade.",
        limit_reached: true,
      }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const tierLimits: Record<string, number> = {
      free: 0, basic: 2, pro: 8, ultimate: 999999,
    };
    const dailyLimit = userEmail === CEO_EMAIL ? 20 : (tierLimits[tier] || 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count } = await admin
      .from("generated_videos")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", today.toISOString());

    if ((count || 0) >= dailyLimit) {
      return new Response(JSON.stringify({
        error: `Daily video limit reached (${dailyLimit}/day). Upgrade for more.`,
        limit_reached: true,
      }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
      console.log("Falling back to image → motion SVD approach...");
      return await imageToMotionFallback(prompt, LEONARDO_API_KEY, SUPABASE_URL, SERVICE_ROLE_KEY, userId);
    }

    const createData = await createRes.json();
    const generationId = createData.motionVideoGenerationJob?.generationId
      || createData.textToVideoGenerationJob?.generationId
      || createData.generationId;

    if (!generationId) {
      console.error("No generationId from text-to-video:", JSON.stringify(createData));
      return await imageToMotionFallback(prompt, LEONARDO_API_KEY, SUPABASE_URL, SERVICE_ROLE_KEY, userId);
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
        const videoItem = gen.generated_images?.find((img: any) => img.motionMP4URL || img.url?.endsWith(".mp4"));
        if (videoItem?.motionMP4URL) { videoUrl = videoItem.motionMP4URL; break; }
        if (videoItem?.url) { videoUrl = videoItem.url; break; }
      }
      if (gen?.status === "FAILED") throw new Error("Video generation failed. Please try again.");
    }

    if (!videoUrl) throw new Error("Video generation timed out. Please try again.");

    const ref = await uploadVideo(admin, userId, prompt, videoUrl);

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

async function uploadVideo(admin: ReturnType<typeof createClient>, userId: string, prompt: string, videoUrl: string): Promise<string> {
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

  if (userId !== "anonymous") {
    await admin.from("generated_videos").insert({
      user_id: userId, prompt, video_url: ref,
    });
  }

  return ref;
}

async function imageToMotionFallback(
  prompt: string, apiKey: string,
  supabaseUrl: string, serviceRoleKey: string, userId: string
) {
  console.log("Using image → motion SVD fallback");

  const imgRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      prompt,
      modelId: "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3",
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

  const motionRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations-motion-svd", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      imageId,
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

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const ref = await uploadVideo(admin, userId, prompt, videoUrl);

  return new Response(JSON.stringify({ video: ref }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
