import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SearchResult { title: string; url: string; snippet: string; thumbnail?: string; }
interface ImageResult { title: string; url: string; imageUrl: string; source: string; thumbnail?: string; }
interface VideoResult { title: string; url: string; thumbnail: string; duration?: string; source: string; }

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Backend not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    // Allow service role key (internal calls from chat function)
    if (token !== SERVICE_ROLE_KEY) {
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
    }

    const { query, type = "web", count = 5 } = await req.json();

    if (!query) {
      throw new Error("Query is required");
    }

    const SERPAPI_API_KEY = Deno.env.get("SERPAPI_API_KEY");
    
    if (!SERPAPI_API_KEY) {
      console.log("SERPAPI_API_KEY not configured, using fallback DuckDuckGo");
      let results: SearchResult[] | ImageResult[] | VideoResult[] = [];
      if (type === "web") {
        results = await searchDuckDuckGo(query, count);
      } else if (type === "images") {
        results = await fallbackImageSearch(query, count);
      } else if (type === "videos") {
        results = await fallbackVideoSearch(query, count);
      }
      return new Response(JSON.stringify({ results, query, type }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let results: SearchResult[] | ImageResult[] | VideoResult[] = [];

    if (type === "web") {
      results = await searchSerpAPIWeb(query, count, SERPAPI_API_KEY);
    } else if (type === "images") {
      results = await searchSerpAPIImages(query, count, SERPAPI_API_KEY);
    } else if (type === "videos") {
      results = await searchSerpAPIVideos(query, count, SERPAPI_API_KEY);
    }

    return new Response(JSON.stringify({ results, query, type }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Web search error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Search failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function searchSerpAPIWeb(query: string, count: number, apiKey: string): Promise<SearchResult[]> {
  try {
    const params = new URLSearchParams({ q: query, api_key: apiKey, engine: "google", num: String(Math.min(count, 10)) });
    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    if (!response.ok) throw new Error(`SerpAPI error: ${response.status}`);
    const data = await response.json();
    const results: SearchResult[] = [];
    if (data.organic_results) {
      for (const item of data.organic_results.slice(0, count)) {
        results.push({ title: item.title || query, url: item.link, snippet: item.snippet || "", thumbnail: item.thumbnail });
      }
    }
    if (data.knowledge_graph && results.length < count) {
      results.unshift({
        title: data.knowledge_graph.title || query,
        url: data.knowledge_graph.website || data.knowledge_graph.source?.link || `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        snippet: data.knowledge_graph.description || "",
        thumbnail: data.knowledge_graph.header_images?.[0]?.image,
      });
    }
    return results.slice(0, count);
  } catch (error) {
    console.error("SerpAPI web search error:", error);
    return searchDuckDuckGo(query, count);
  }
}

async function searchSerpAPIImages(query: string, count: number, apiKey: string): Promise<ImageResult[]> {
  try {
    const params = new URLSearchParams({ q: query, api_key: apiKey, engine: "google_images", num: String(Math.min(count + 5, 20)) });
    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    if (!response.ok) throw new Error(`SerpAPI images error: ${response.status}`);
    const data = await response.json();
    const results: ImageResult[] = [];
    if (data.images_results) {
      for (const item of data.images_results.slice(0, count)) {
        results.push({ title: item.title || query, url: item.link || item.original, imageUrl: item.original || item.thumbnail, thumbnail: item.thumbnail, source: item.source || new URL(item.link || item.original).hostname });
      }
    }
    return results;
  } catch (error) {
    console.error("SerpAPI image search error:", error);
    return fallbackImageSearch(query, count);
  }
}

async function searchSerpAPIVideos(query: string, count: number, apiKey: string): Promise<VideoResult[]> {
  try {
    const params = new URLSearchParams({ q: query, api_key: apiKey, engine: "google_videos", num: String(Math.min(count + 3, 15)) });
    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    if (!response.ok) throw new Error(`SerpAPI videos error: ${response.status}`);
    const data = await response.json();
    const results: VideoResult[] = [];
    if (data.video_results) {
      for (const item of data.video_results.slice(0, count)) {
        results.push({ title: item.title || query, url: item.link, thumbnail: item.thumbnail?.static || item.thumbnail || "", duration: item.duration, source: item.source || "YouTube" });
      }
    }
    return results;
  } catch (error) {
    console.error("SerpAPI video search error:", error);
    return fallbackVideoSearch(query, count);
  }
}

async function searchDuckDuckGo(query: string, count: number): Promise<SearchResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(`https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`);
    if (!response.ok) throw new Error("DuckDuckGo search failed");
    const data = await response.json();
    const results: SearchResult[] = [];
    if (data.Abstract) {
      results.push({ title: data.Heading || query, url: data.AbstractURL || `https://duckduckgo.com/?q=${encodedQuery}`, snippet: data.Abstract, thumbnail: data.Image || undefined });
    }
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, count - results.length)) {
        if (topic.Text && topic.FirstURL) {
          results.push({ title: topic.Text.split(" - ")[0] || topic.Text.slice(0, 60), url: topic.FirstURL, snippet: topic.Text, thumbnail: topic.Icon?.URL || undefined });
        }
      }
    }
    if (results.length === 0) {
      results.push({ title: `Search results for "${query}"`, url: `https://duckduckgo.com/?q=${encodedQuery}`, snippet: `Click to see full search results for "${query}" on DuckDuckGo.` });
    }
    return results.slice(0, count);
  } catch (error) {
    console.error("DuckDuckGo search error:", error);
    return [{ title: `Search "${query}"`, url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`, snippet: `Search for "${query}" on DuckDuckGo` }];
  }
}

function fallbackImageSearch(query: string, count: number): ImageResult[] {
  const encodedQuery = encodeURIComponent(query);
  return [{ title: query, url: `https://www.google.com/search?q=${encodedQuery}&tbm=isch`, imageUrl: `https://via.placeholder.com/400x300?text=${encodedQuery}`, source: "Google Images" }];
}

function fallbackVideoSearch(query: string, count: number): VideoResult[] {
  const encodedQuery = encodeURIComponent(query);
  return [{ title: query, url: `https://www.youtube.com/results?search_query=${encodedQuery}`, thumbnail: `https://via.placeholder.com/480x360?text=${encodedQuery}`, source: "YouTube" }];
}
