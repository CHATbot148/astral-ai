import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
    if (!DEEPGRAM_API_KEY) {
      throw new Error("DEEPGRAM_API_KEY is not configured");
    }

    const contentType = req.headers.get("content-type") || "";
    let audioData: ArrayBuffer;

    if (contentType.includes("application/json")) {
      // Base64 encoded audio
      const { audio, mimeType = "audio/webm" } = await req.json();
      if (!audio) throw new Error("Audio data is required");
      
      // Decode base64
      const binaryString = atob(audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      audioData = bytes.buffer;
    } else {
      // Raw audio data
      audioData = await req.arrayBuffer();
    }

    console.log("Sending audio to Deepgram, size:", audioData.byteLength);

    const response = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          "Content-Type": "audio/webm",
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

    console.log("Transcription result:", transcript);

    return new Response(
      JSON.stringify({ transcript, confidence: result.results?.channels?.[0]?.alternatives?.[0]?.confidence }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("STT error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
