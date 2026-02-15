import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EDGE_TTS_VOICES: Record<string, string> = {
  en: "en-US-JennyNeural",
  zh: "zh-CN-XiaoxiaoNeural",
  hi: "hi-IN-MadhurNeural",
  es: "es-ES-AlvaroNeural",
  fr: "fr-FR-DeniseNeural",
  ar: "ar-SA-HamedNeural",
  bn: "bn-BD-NabanitaNeural",
  pt: "pt-BR-AntonioNeural",
  ru: "ru-RU-DmitryNeural",
  ja: "ja-JP-KeitaNeural",
  ha: "ha-NG-SarkinNeural",
  yo: "yo-NG-SadeNeural",
  ig: "ig-NG-AbeoNeural",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, languageCode = "en" } = await req.json();
    if (!text) throw new Error("Text is required");

    const voice = EDGE_TTS_VOICES[languageCode];
    if (!voice) {
      throw new Error(`Voice not available for language: ${languageCode}`);
    }

    const truncatedText = String(text).slice(0, 2000);

    // Try primary free Edge TTS proxy
    const proxyUrl = `https://api.tts.quest/v1/edge-tts?text=${encodeURIComponent(truncatedText)}&voice=${encodeURIComponent(voice)}`;
    const audioResponse = await fetch(proxyUrl);

    if (audioResponse.ok) {
      const data = await audioResponse.json();
      if (data.url) {
        const audioFileResponse = await fetch(data.url);
        const audioBuffer = await audioFileResponse.arrayBuffer();
        return new Response(audioBuffer, {
          headers: { ...corsHeaders, "Content-Type": "audio/mpeg" },
        });
      }
    }

    // Fallback
    const fallbackUrl = `https://tts.langeek.co/READ_TEXT/${encodeURIComponent(truncatedText)}/${voice}`;
    const fallbackResponse = await fetch(fallbackUrl);

    if (!fallbackResponse.ok) {
      throw new Error(`Edge TTS failed for language ${languageCode}`);
    }

    const audioBuffer = await fallbackResponse.arrayBuffer();
    return new Response(audioBuffer, {
      headers: { ...corsHeaders, "Content-Type": "audio/mpeg" },
    });
  } catch (error) {
    console.error("Edge TTS error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
