import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    // Authenticate user
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
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Invalid authentication token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { text, languageCode = "en" } = await req.json();
    if (!text) throw new Error("Text is required");

    const voice = EDGE_TTS_VOICES[languageCode];
    if (!voice) {
      throw new Error(`Voice not available for language: ${languageCode}`);
    }

    const truncatedText = String(text).slice(0, 2000);

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
