import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Deepgram Aura voices - 8 feminine, 8 masculine
const VOICE_MAP: Record<string, string> = {
  // Feminine voices
  asteria: "aura-asteria-en",
  luna: "aura-luna-en",
  athena: "aura-athena-en",
  hera: "aura-hera-en",
  stella: "aura-stella-en",
  aurora: "aura-2-aurora-en",
  thalia: "aura-2-thalia-en",
  cordelia: "aura-2-cordelia-en",
  // Masculine voices
  orion: "aura-orion-en",
  zeus: "aura-zeus-en",
  helios: "aura-helios-en",
  arcas: "aura-arcas-en",
  perseus: "aura-perseus-en",
  angus: "aura-angus-en",
  orpheus: "aura-orpheus-en",
  apollo: "aura-2-apollo-en",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, voiceId = "asteria" } = await req.json();

    const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
    if (!DEEPGRAM_API_KEY) {
      throw new Error("DEEPGRAM_API_KEY is not configured");
    }

    if (!text) throw new Error("Text is required");

    const truncatedText = String(text).slice(0, 2000);

    // Find the voice model
    const voiceKey =
      Object.keys(VOICE_MAP).find((k) => String(voiceId).toLowerCase().includes(k)) || "asteria";
    const deepgramVoiceModel = VOICE_MAP[voiceKey] || VOICE_MAP.asteria;

    console.log(`Using Deepgram voice: ${deepgramVoiceModel}`);

    const response = await fetch(
      `https://api.deepgram.com/v1/speak?model=${deepgramVoiceModel}&encoding=mp3`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: truncatedText }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Deepgram TTS error:", response.status, errText);
      throw new Error(`Deepgram TTS failed: ${response.status}`);
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
