import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Backend not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid authentication token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
    if (!DEEPGRAM_API_KEY) {
      throw new Error("DEEPGRAM_API_KEY is not configured");
    }

    const contentType = req.headers.get("content-type") || "";
    let audioData: ArrayBuffer;
    let detectedMime = "audio/webm";

    if (contentType.includes("application/json")) {
      const { audio, mimeType = "audio/webm" } = await req.json();
      if (!audio) throw new Error("Audio data is required");
      detectedMime = mimeType;

      const binaryString = atob(audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      audioData = bytes.buffer;
    } else {
      audioData = await req.arrayBuffer();
      if (contentType) detectedMime = contentType.split(";")[0].trim();
    }

    // Map browser mime types to Deepgram-compatible content types
    const mimeMap: Record<string, string> = {
      "audio/webm": "audio/webm",
      "audio/mp4": "audio/mp4",
      "audio/m4a": "audio/mp4",
      "audio/x-m4a": "audio/mp4",
      "audio/aac": "audio/aac",
      "audio/ogg": "audio/ogg",
      "audio/wav": "audio/wav",
      "audio/mpeg": "audio/mpeg",
    };
    const dgContentType = mimeMap[detectedMime] || "audio/webm";

    console.log("Sending audio to Deepgram, size:", audioData.byteLength, "mime:", dgContentType);

    const response = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          "Content-Type": dgContentType,
        },
        body: audioData,
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Deepgram STT error:", response.status, errText);
      throw new Error(`Deepgram STT failed: ${response.status}`);
    }

    const result = await response.json();
    const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";

    return new Response(
      JSON.stringify({ transcript, confidence: result.results?.channels?.[0]?.alternatives?.[0]?.confidence }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("STT error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
