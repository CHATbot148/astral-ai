import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Deepgram Aura voices - 8 feminine, 8 masculine
const VOICE_MAP: Record<string, string> = {
  asteria: "aura-asteria-en",
  luna: "aura-luna-en",
  athena: "aura-athena-en",
  hera: "aura-hera-en",
  stella: "aura-stella-en",
  aurora: "aura-2-aurora-en",
  thalia: "aura-2-thalia-en",
  cordelia: "aura-2-cordelia-en",
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

    const { text, voiceId = "asteria" } = await req.json();

    const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
    if (!DEEPGRAM_API_KEY) {
      throw new Error("DEEPGRAM_API_KEY is not configured");
    }

    if (!text) throw new Error("Text is required");

    const voiceKey =
      Object.keys(VOICE_MAP).find((k) => String(voiceId).toLowerCase().includes(k)) || "asteria";
    const deepgramVoiceModel = VOICE_MAP[voiceKey] || VOICE_MAP.asteria;

    // Split long text into chunks at sentence boundaries (Deepgram has ~2000 char limit per request)
    const fullText = String(text).trim();
    const MAX_CHUNK = 1800;
    const chunks: string[] = [];
    if (fullText.length <= MAX_CHUNK) {
      chunks.push(fullText);
    } else {
      // Split on sentence boundaries, then accumulate up to MAX_CHUNK
      const sentences = fullText.match(/[^.!?\n]+[.!?\n]+|\S+/g) || [fullText];
      let current = "";
      for (const s of sentences) {
        if ((current + s).length > MAX_CHUNK && current) {
          chunks.push(current.trim());
          current = s;
        } else {
          current += s;
        }
        // Hard split words longer than MAX_CHUNK
        while (current.length > MAX_CHUNK) {
          chunks.push(current.slice(0, MAX_CHUNK));
          current = current.slice(MAX_CHUNK);
        }
      }
      if (current.trim()) chunks.push(current.trim());
    }

    // Synthesize each chunk in parallel and concatenate MP3 frames
    const audioBuffers = await Promise.all(
      chunks.map(async (chunk) => {
        const r = await fetch(
          `https://api.deepgram.com/v1/speak?model=${deepgramVoiceModel}&encoding=mp3`,
          {
            method: "POST",
            headers: {
              Authorization: `Token ${DEEPGRAM_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ text: chunk }),
          }
        );
        if (!r.ok) {
          const errText = await r.text();
          console.error("Deepgram TTS error:", r.status, errText);
          throw new Error(`Deepgram TTS failed: ${r.status}`);
        }
        return new Uint8Array(await r.arrayBuffer());
      })
    );

    const totalLen = audioBuffers.reduce((sum, b) => sum + b.byteLength, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const b of audioBuffers) {
      merged.set(b, offset);
      offset += b.byteLength;
    }

    return new Response(merged, {
      headers: { ...corsHeaders, "Content-Type": "audio/mpeg" },
    });
  } catch (error) {
    console.error("TTS error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
