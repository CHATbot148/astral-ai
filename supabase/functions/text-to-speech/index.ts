import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ElevenLabs voice IDs
const VOICE_MAP: Record<string, string> = {
  "george": "JBFqnCBsd6RMkjVDRZzb",
  "sarah": "EXAVITQu4vr4xnSDxMaL",
  "laura": "FGY2WhTYpPnrIDTdsKH5",
  "liam": "TX3LPaxmHKxFdv7VOQHJ",
  "lily": "pFZP5JQG7iQjIQuC4Bku",
  "daniel": "onwK4e9ZLuTAKqWW03F9",
  "roger": "CwhRBWXzGAHq8TQ4Fs17",
  "alice": "Xb7hH8MSUJpSbSDYk0k2",
  "charlie": "IKne3meq5aSn9XLyUdCD",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, voiceId = "george" } = await req.json();
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || Deno.env.get("ELEVENLABS_API_KEY2");

    if (!text) {
      throw new Error("Text is required");
    }

    // Limit text length
    const truncatedText = text.slice(0, 4000);
    
    // Resolve voice ID
    const voiceKey = Object.keys(VOICE_MAP).find(k => voiceId.toLowerCase().includes(k)) || "george";
    const elevenLabsVoiceId = VOICE_MAP[voiceKey] || VOICE_MAP["george"];

    // Try ElevenLabs first if API key is available
    if (ELEVENLABS_API_KEY) {
      try {
        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${elevenLabsVoiceId}?output_format=mp3_44100_128`,
          {
            method: "POST",
            headers: {
              "xi-api-key": ELEVENLABS_API_KEY,
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

        if (response.ok) {
          const audioBuffer = await response.arrayBuffer();
          return new Response(audioBuffer, {
            headers: {
              ...corsHeaders,
              "Content-Type": "audio/mpeg",
            },
          });
        } else {
          const errorText = await response.text();
          console.error("ElevenLabs error:", response.status, errorText);
        }
      } catch (e) {
        console.error("ElevenLabs fetch error:", e);
      }
    }

    // Fallback: Return signal for client-side synthesis
    return new Response(
      JSON.stringify({ 
        useBrowserSynthesis: true,
        text: truncatedText,
        voice: { name: voiceKey, lang: "en-US", pitch: 1.0, rate: 1.0 },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
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
