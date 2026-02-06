import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Common search terms mapping for better GIF matching
const SEARCH_MAPPINGS: Record<string, string[]> = {
  "laughing": ["laughing", "lol", "haha", "funny"],
  "happy": ["happy", "joy", "excited", "yay"],
  "sad": ["sad", "crying", "tears", "upset"],
  "love": ["love", "heart", "adore", "affection"],
  "thank you": ["thank you", "thanks", "grateful", "appreciation"],
  "celebration": ["celebration", "party", "confetti", "celebrate"],
  "hug": ["hug", "embrace", "comfort", "caring"],
  "excited": ["excited", "pumped", "hyped", "enthusiasm"],
  "party": ["party", "dance", "celebration", "fun"],
  "thumbs up": ["thumbs up", "approve", "good job", "nice"],
  "clap": ["clap", "applause", "bravo", "congrats"],
  "thinking": ["thinking", "hmm", "ponder", "consider"],
  "surprise": ["surprise", "shocked", "wow", "omg"],
  "angry": ["angry", "mad", "frustrated", "annoyed"],
  "cool": ["cool", "sunglasses", "awesome", "chill"],
  "wave": ["wave", "hello", "hi", "greeting"],
  "bye": ["bye", "goodbye", "farewell", "see you"],
  "yes": ["yes", "nod", "agree", "affirmative"],
  "no": ["no", "shake head", "disagree", "nope"],
  "fire": ["fire", "lit", "hot", "flames"],
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, limit = 1 } = await req.json();
    const GIPHY_API_KEY = Deno.env.get("GIPHY_API_KEY");

    if (!GIPHY_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Giphy API key not configured", gifs: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!query) {
      return new Response(
        JSON.stringify({ error: "Query is required", gifs: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Try to find a better search term
    const normalizedQuery = query.toLowerCase().trim();
    let searchTerms = [normalizedQuery];
    
    // Check if we have a mapping for this query
    for (const [key, alternatives] of Object.entries(SEARCH_MAPPINGS)) {
      if (normalizedQuery.includes(key) || alternatives.some(alt => normalizedQuery.includes(alt))) {
        searchTerms = [key, ...alternatives.slice(0, 2)];
        break;
      }
    }

    let gifs: Array<{ url: string; title: string; width: number; height: number }> = [];
    
    // Try each search term until we get results
    for (const term of searchTerms) {
      const response = await fetch(
        `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(term)}&limit=${Math.min(limit * 2, 10)}&rating=pg-13&lang=en`
      );

      if (!response.ok) {
        console.error("Giphy API error:", response.status);
        continue;
      }

      const data = await response.json();
      
      if (data.data && data.data.length > 0) {
        gifs = data.data.slice(0, limit).map((gif: any) => ({
          url: gif.images?.fixed_width?.url || gif.images?.original?.url,
          title: gif.title || term,
          width: parseInt(gif.images?.fixed_width?.width || "100"),
          height: parseInt(gif.images?.fixed_width?.height || "100"),
        }));
        break;
      }
    }

    // If still no results, try trending as fallback
    if (gifs.length === 0) {
      const trendingResponse = await fetch(
        `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=${limit}&rating=pg-13`
      );
      
      if (trendingResponse.ok) {
        const trendingData = await trendingResponse.json();
        if (trendingData.data && trendingData.data.length > 0) {
          gifs = trendingData.data.slice(0, limit).map((gif: any) => ({
            url: gif.images?.fixed_width?.url || gif.images?.original?.url,
            title: gif.title || "trending",
            width: parseInt(gif.images?.fixed_width?.width || "100"),
            height: parseInt(gif.images?.fixed_width?.height || "100"),
          }));
        }
      }
    }

    return new Response(
      JSON.stringify({ gifs, query: normalizedQuery }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Fetch GIF error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error", gifs: [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});