import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Voice options using Web Speech API compatible voice names
// We'll use Google Cloud TTS via their free tier or browser native
const VOICE_MAP: Record<string, { name: string; lang: string; pitch: number; rate: number }> = {
  "george": { name: "George", lang: "en-GB", pitch: 0.9, rate: 1.0 },
  "sarah": { name: "Sarah", lang: "en-US", pitch: 1.1, rate: 1.0 },
  "laura": { name: "Laura", lang: "en-US", pitch: 1.0, rate: 0.95 },
  "liam": { name: "Liam", lang: "en-US", pitch: 0.85, rate: 1.0 },
  "lily": { name: "Lily", lang: "en-GB", pitch: 1.15, rate: 1.0 },
  "daniel": { name: "Daniel", lang: "en-GB", pitch: 0.8, rate: 0.95 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, voiceId = "george" } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!text) {
      throw new Error("Text is required");
    }

    // Limit text length
    const truncatedText = text.slice(0, 4000);
    
    // Map voice ID to a simpler identifier
    const voiceKey = voiceId.toLowerCase().includes("george") ? "george" :
                     voiceId.toLowerCase().includes("sarah") ? "sarah" :
                     voiceId.toLowerCase().includes("laura") ? "laura" :
                     voiceId.toLowerCase().includes("liam") ? "liam" :
                     voiceId.toLowerCase().includes("lily") ? "lily" :
                     voiceId.toLowerCase().includes("daniel") ? "daniel" : "george";

    const voice = VOICE_MAP[voiceKey] || VOICE_MAP["george"];

    // Use Lovable AI Gateway for TTS (via a model that supports it)
    // Since direct TTS isn't available, we'll generate SSML-like text and use browser synthesis
    // For now, return a simple audio generation placeholder
    
    // Alternative: Use a free TTS service like Google's unofficial endpoint
    const googleTTSUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${voice.lang}&client=tw-ob&q=${encodeURIComponent(truncatedText)}`;
    
    try {
      const ttsResponse = await fetch(googleTTSUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (ttsResponse.ok) {
        const audioBuffer = await ttsResponse.arrayBuffer();
        return new Response(audioBuffer, {
          headers: {
            ...corsHeaders,
            "Content-Type": "audio/mpeg",
          },
        });
      }
    } catch (e) {
      console.log("Google TTS fallback failed, using browser synthesis signal");
    }

    // Return a signal for client-side synthesis
    return new Response(
      JSON.stringify({ 
        useBrowserSynthesis: true,
        text: truncatedText,
        voice: voice,
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
