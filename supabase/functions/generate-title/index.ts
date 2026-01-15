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
    const { message } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!message) {
      return new Response(
        JSON.stringify({ title: "New Chat" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!LOVABLE_API_KEY) {
      // Fallback: just take first 15 chars
      const fallbackTitle = message.slice(0, 15).trim() || "New Chat";
      return new Response(
        JSON.stringify({ title: fallbackTitle }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: "Generate a very short title (max 15 characters) that summarizes the user's message. Return ONLY the title, nothing else. No quotes, no punctuation at the end. Be creative but concise."
          },
          {
            role: "user",
            content: message
          }
        ],
        max_tokens: 20,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const fallbackTitle = message.slice(0, 15).trim() || "New Chat";
      return new Response(
        JSON.stringify({ title: fallbackTitle }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    let title = data.choices?.[0]?.message?.content?.trim() || message.slice(0, 15);
    
    // Ensure max 15 characters
    title = title.slice(0, 15).trim();
    
    // Remove trailing punctuation
    title = title.replace(/[.!?,;:]+$/, '');

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
