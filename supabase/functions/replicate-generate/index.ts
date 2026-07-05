import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://connector-gateway.lovable.dev/replicate/v1";

const IMAGE_MODELS: Record<string, string> = {
  flux_schnell: "black-forest-labs/flux-schnell",
  flux_pro: "black-forest-labs/flux-1.1-pro",
  sdxl: "stability-ai/sdxl",
  ideogram_v2: "ideogram-ai/ideogram-v2",
};

const VIDEO_MODELS: Record<string, string> = {
  wan_22_fast: "wan-video/wan-2.2-i2v-fast",
};

const ASPECT_MAP: Record<string, string> = {
  "1:1": "1:1",
  "16:9": "16:9",
  "9:16": "9:16",
  "3:2": "3:2",
  "4:3": "4:3",
};

function authHeaders(connectorKey: string, lovableKey: string) {
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connectorKey,
    "Content-Type": "application/json",
  };
}

async function createPrediction(model: string, input: any, lovableKey: string, connectorKey: string) {
  const res = await fetch(`${GATEWAY}/models/${model}/predictions`, {
    method: "POST",
    headers: authHeaders(connectorKey, lovableKey),
    body: JSON.stringify({ input }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Replicate create failed (${res.status}): ${JSON.stringify(json)}`);
  return json;
}

async function pollPrediction(id: string, lovableKey: string, connectorKey: string, maxMs = 9 * 60_000) {
  const start = Date.now();
  let backoff = 2000;
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, backoff));
    backoff = Math.min(backoff + 1000, 8000);
    const res = await fetch(`${GATEWAY}/predictions/${id}`, {
      headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": connectorKey },
    });
    const json = await res.json();
    if (json.status === "succeeded") return json;
    if (json.status === "failed" || json.status === "canceled") {
      throw new Error(`Replicate ${json.status}: ${json.error || "unknown"}`);
    }
  }
  throw new Error("Replicate timed out");
}

async function downloadFirstOutput(out: any): Promise<{ bytes: Uint8Array; mime: string }> {
  const url = Array.isArray(out) ? out[0] : typeof out === "string" ? out : out?.url ?? null;
  if (!url) throw new Error("No output URL");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const mime = res.headers.get("content-type") || "image/png";
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const REPLICATE_API_KEY = Deno.env.get("REPLICATE_API_KEY") || Deno.env.get("LOVABLE_CONNECTOR_REPLICATE_API_KEY");
    if (!LOVABLE_API_KEY || !REPLICATE_API_KEY) {
      return new Response(JSON.stringify({ error: "Replicate connector not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { kind, modelId, prompt, aspectRatio, imageUrl } = body;

    // Auth required — no anonymous callers. Enforce subscription/quota like other gen endpoints.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data: authData } = await admin.auth.getUser(authHeader.slice(7));
    const userId = authData?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enforce subscription tier + daily image quota
    const { data: sub } = await admin
      .from("subscriptions")
      .select("tier, status, expires_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    const tier = sub && sub.status === "active" && (!sub.expires_at || new Date(sub.expires_at) > new Date())
      ? sub.tier : "free";
    const tierLimits: Record<string, number> = { free: 5, basic: 10, pro: 25, ultimate: 999999 };
    const today = new Date().toISOString().split("T")[0];
    if (kind === "image") {
      const { data: usage } = await admin
        .from("daily_usage").select("images_generated")
        .eq("user_id", userId).eq("usage_date", today).maybeSingle();
      const used = usage?.images_generated ?? 0;
      const limit = tierLimits[tier] ?? 5;
      if (used >= limit) {
        return new Response(JSON.stringify({ error: `Daily image limit reached (${limit}/day).`, limit_reached: true }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (kind === "video") {
      if (tier === "free") {
        return new Response(JSON.stringify({ error: "Video generation requires a paid plan." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (kind === "image") {
      const model = IMAGE_MODELS[modelId];
      if (!model) throw new Error(`Unknown image model: ${modelId}`);
      const input: any = { prompt };
      if (aspectRatio && ASPECT_MAP[aspectRatio]) input.aspect_ratio = ASPECT_MAP[aspectRatio];
      if (imageUrl && modelId === "flux_pro") input.image_prompt = imageUrl;
      const pred = await createPrediction(model, input, LOVABLE_API_KEY, REPLICATE_API_KEY);
      const finished = await pollPrediction(pred.id, LOVABLE_API_KEY, REPLICATE_API_KEY, 4 * 60_000);
      const { bytes, mime } = await downloadFirstOutput(finished.output);
      // Upload to chat-files
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
      const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
      const path = `${userId}/generated/replicate-${Date.now()}.${ext}`;
      await admin.storage.from("chat-files").upload(path, bytes, { contentType: mime, upsert: false });
      const ref = `storage:chat-files/${path}`;
      if (userId !== "anonymous") {
        await admin.from("generated_images").insert({ user_id: userId, prompt, image_url: ref, style: "none", aspect_ratio: aspectRatio || "1:1" });
      }
      return new Response(JSON.stringify({ image: ref }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (kind === "video") {
      const model = VIDEO_MODELS[modelId];
      if (!model) throw new Error(`Unknown video model: ${modelId}`);
      if (!imageUrl) throw new Error("Video model requires a reference image (image-to-video)");
      const input: any = { image: imageUrl, prompt };
      const pred = await createPrediction(model, input, LOVABLE_API_KEY, REPLICATE_API_KEY);
      const finished = await pollPrediction(pred.id, LOVABLE_API_KEY, REPLICATE_API_KEY, 9 * 60_000);
      const { bytes, mime } = await downloadFirstOutput(finished.output);
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
      const ext = mime.includes("mp4") ? "mp4" : mime.includes("webm") ? "webm" : "mp4";
      const path = `${userId}/generated/replicate-${Date.now()}.${ext}`;
      await admin.storage.from("chat-files").upload(path, bytes, { contentType: mime || "video/mp4", upsert: false });
      const ref = `storage:chat-files/${path}`;
      return new Response(JSON.stringify({ video: ref }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error("kind must be 'image' or 'video'");
  } catch (e) {
    console.error("replicate-generate error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
