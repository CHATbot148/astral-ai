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

    const { message } = await req.json();
    const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");

    if (!message) {
      return new Response(
        JSON.stringify({ title: "New Chat" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fitTitle = (value: string, max = 15) => {
      const cleaned = value
        .replace(/^generate\s+(?:an?\s+)?(?:image|picture|photo)\s*(?:of|for)?\s*/i, "")
        .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!cleaned) return "New Chat";
      if (cleaned.length <= max) return cleaned;
      const words = cleaned.split(" ").filter(Boolean);
      let out = "";
      for (const word of words) {
        const next = out ? `${out} ${word}` : word;
        if (next.length > max) break;
        out = next;
      }
      return out || cleaned.slice(0, max).trim() || "New Chat";
    };

    if (!MISTRAL_API_KEY) {
      const fallbackTitle = fitTitle(message);
      return new Response(
        JSON.stringify({ title: fallbackTitle }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [
          {
            role: "system",
            content:
              "You generate a compact, descriptive chat title (1–3 words, max 15 characters) that captures the TOPIC of the user's first message. " +
              "Rules: Use Title Case. Prefer complete words that fit under 15 characters; never return an incomplete/truncated word. No quotes, no emojis, no trailing punctuation. Do NOT use generic words like 'Chat', 'Conversation', 'Help', 'Question', 'New Chat', 'Untitled'. " +
              "Do NOT echo the user's literal phrasing if it's a greeting or filler — infer the underlying topic instead. " +
              "Examples: 'How do photosynthesis work?' -> 'Photosynthesis'. 'help me debug my react code' -> 'React Debug'. " +
              "'write a poem about the sea' -> 'Sea Poem'. 'who won the world cup' -> 'World Cup'. " +
              "Return ONLY the title."
          },
          { role: "user", content: message }
        ],
        max_tokens: 12,
        temperature: 0.5,
      }),
    });

    if (!response.ok) {
      const fallbackTitle = fitTitle(message);
      return new Response(
        JSON.stringify({ title: fallbackTitle }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    let title = data.choices?.[0]?.message?.content?.trim() || message;
    // Strip quotes and leading/trailing punctuation, then fit under 15 chars
    title = title.replace(/^["'`""]+|["'`""]+$/g, '').trim();
    title = title.replace(/[.!?,;:]+$/, '');
    title = fitTitle(title);
    // Guard against generic fallbacks the model sometimes returns
    if (!title || /^(new chat|chat|conversation|untitled|help|question|message)$/i.test(title)) {
      title = fitTitle(message);
    }


    return new Response(
      JSON.stringify({ title: title || "New Chat" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Generate title error:", error);
    return new Response(
      JSON.stringify({ title: "New Chat" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
