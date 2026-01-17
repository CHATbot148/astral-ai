import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VOICE_MAP: Record<string, string> = {
  george: "JBFqnCBsd6RMkjVDRZzb",
  sarah: "EXAVITQu4vr4xnSDxMaL",
  laura: "FGY2WhTYpPnrIDTdsKH5",
  liam: "TX3LPaxmHKxFdv7VOQHJ",
  lily: "pFZP5JQG7iQjIQuC4Bku",
  daniel: "onwK4e9ZLuTAKqWW03F9",
  roger: "CwhRBWXzGAHq8TQ4Fs17",
  alice: "Xb7hH8MSUJpSbSDYk0k2",
  charlie: "IKne3meq5aSn9XLyUdCD",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, voiceId = "george" } = await req.json();

    const ELEVENLABS_API_KEY2 = Deno.env.get("ELEVENLABS_API_KEY2");
    if (!ELEVENLABS_API_KEY2) {
      throw new Error("ELEVENLABS_API_KEY2 is not configured");
    }

    if (!text) throw new Error("Text is required");

    const truncatedText = String(text).slice(0, 4000);

    const voiceKey =
      Object.keys(VOICE_MAP).find((k) => String(voiceId).toLowerCase().includes(k)) || "george";
    const elevenVoiceId = VOICE_MAP[voiceKey] || VOICE_MAP.george;

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${elevenVoiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY2,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: truncatedText,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("ElevenLabs TTS error:", response.status, errText);
      throw new Error("ElevenLabs TTS failed");
    }

    const audioBuffer = await response.arrayBuffer();
    return new Response(audioBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
      },
    });
  } catch (error) {
    console.error("TTS error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
