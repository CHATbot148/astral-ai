import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { texts, targetLanguage } = await req.json();
    if (!texts || !Array.isArray(texts) || texts.length === 0) throw new Error("texts array is required");
    if (!targetLanguage) throw new Error("targetLanguage is required");

    const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");
    if (!MISTRAL_API_KEY) throw new Error("Translation service not configured");

    // Build a prompt that translates all texts at once
    const numberedTexts = texts.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n");

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
            content: `You are a translator. Translate the following numbered texts to ${targetLanguage}. Return ONLY a JSON array of translated strings in the same order, no numbering, no explanation. Example: ["translated1", "translated2"]. Keep UI labels short and natural. Do not translate brand names like "X-AI", "X-Tech".`,
          },
          {
            role: "user",
            content: numberedTexts,
          },
        ],
        temperature: 0.1,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Translation API failed: ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "[]";

    // Parse the JSON array from the response
    let translations: string[];
    try {
      // Try to extract JSON array from the response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      translations = jsonMatch ? JSON.parse(jsonMatch[0]) : texts;
    } catch {
      console.error("Failed to parse translations:", content);
      translations = texts; // Fallback to original texts
    }

    // Ensure we have the right number of translations
    while (translations.length < texts.length) {
      translations.push(texts[translations.length]);
    }

    return new Response(JSON.stringify({ translations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Translate error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
