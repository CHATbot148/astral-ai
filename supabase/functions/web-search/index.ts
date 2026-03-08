import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SearchResult { title: string; url: string; snippet: string; thumbnail?: string; }
interface ImageResult { title: string; url: string; imageUrl: string; source: string; thumbnail?: string; }
interface VideoResult { title: string; url: string; thumbnail: string; duration?: string; source: string; }

const BROKEN_IMAGE_HOSTS = new Set(["imgur.com", "i.imgur.com"]);

const QUERY_PREFIX = /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?(?:would\s+you\s+)?(?:search|search\s+up|look\s*up|google|find\s*out|find|check|show\s+me)\s+(?:for\s+|up\s+|about\s+|on\s+|the\s+)?/i;
const QUERY_SUFFIX = /(?:\s+(?:for\s+me|please|thanks?|thank\s+you))+$|[?!.]+$/gi;
const SOFT_STOPWORDS = new Set(["the", "a", "an", "of", "for", "about", "on", "in", "to", "is", "are", "me", "show", "search", "find", "look", "up"]);

function rewriteSearchQuery(input: string, type: "web" | "images" | "videos"): string {
  const cleaned = input.trim().replace(/^['"“”‘’`]+|['"“”‘’`]+$/g, "");
  let normalized = cleaned
    .replace(QUERY_PREFIX, "")
    .replace(/^(?:an?\s+)?(?:image|photo|picture|video)s?\s+(?:of|for|about)\s+/i, "")
    .replace(QUERY_SUFFIX, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!normalized) normalized = cleaned;

  if (type !== "web") {
    normalized = normalized
      .replace(/\b(?:images?|photos?|pictures?|videos?)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim() || cleaned;
  }

  return normalized;
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !SOFT_STOPWORDS.has(token));
}

function relevanceScore(text: string, tokens: string[]): number {
  if (!tokens.length) return 0;
  const normalized = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (normalized.includes(token)) score += 1;
  }
  return score / tokens.length;
}

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

    if (!query || typeof query !== "string") {
      throw new Error("Query is required");
    }

    const rewrittenQuery = rewriteSearchQuery(query, type);
    const safeCount = Math.max(1, Math.min(count, type === "web" ? 10 : 8));

    const SERPAPI_API_KEY = Deno.env.get("SERPAPI_API_KEY");
    
    if (!SERPAPI_API_KEY) {
      console.log("SERPAPI_API_KEY not configured, using provider fallback");
      let results: SearchResult[] | ImageResult[] | VideoResult[] = [];
      if (type === "web") {
        results = await searchDuckDuckGo(rewrittenQuery, safeCount);
      } else if (type === "images") {
        results = await fallbackImageSearch(rewrittenQuery, safeCount);
      } else if (type === "videos") {
        results = await fallbackVideoSearch(rewrittenQuery, safeCount);
      }
      return new Response(JSON.stringify({ results, query: rewrittenQuery, originalQuery: query, type }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let results: SearchResult[] | ImageResult[] | VideoResult[] = [];

    if (type === "web") {
      results = await searchSerpAPIWeb(rewrittenQuery, safeCount, SERPAPI_API_KEY);
    } else if (type === "images") {
      results = await searchSerpAPIImages(rewrittenQuery, safeCount, SERPAPI_API_KEY);
    } else if (type === "videos") {
      results = await searchSerpAPIVideos(rewrittenQuery, safeCount, SERPAPI_API_KEY);
    }

    return new Response(JSON.stringify({ results, query: rewrittenQuery, originalQuery: query, type }), {
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
    const params = new URLSearchParams({ q: query, api_key: apiKey, engine: "google_images", num: String(Math.min(count + 30, 50)) });
    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    if (!response.ok) throw new Error(`SerpAPI images error: ${response.status}`);
    const data = await response.json();

    const tokens = tokenizeQuery(query);
    const candidates = (Array.isArray(data.images_results) ? data.images_results : [])
      .map((item: any) => {
        const imageUrl = item.original || item.thumbnail;
        const pageUrl = item.link || item.original;
        const title = item.title || query;
        const sourceHost = safeHostname(pageUrl || imageUrl);
        const relevanceText = `${title} ${item.source || ""} ${pageUrl || ""}`;
        return {
          item,
          imageUrl,
          pageUrl,
          title,
          sourceHost,
          score: relevanceScore(relevanceText, tokens),
        };
      })
      .filter((candidate: any) => candidate.imageUrl && candidate.pageUrl && candidate.sourceHost && !BROKEN_IMAGE_HOSTS.has(candidate.sourceHost))
      .sort((a: any, b: any) => b.score - a.score);

    const results: ImageResult[] = [];

    for (const candidate of candidates) {
      if (results.length >= count) break;
      if (tokens.length > 0 && candidate.score <= 0 && results.length > 0) continue;

      const reachable = await isReachableMedia(candidate.imageUrl, "image");
      if (!reachable) continue;

      results.push({
        title: candidate.title,
        url: candidate.pageUrl,
        imageUrl: candidate.imageUrl,
        thumbnail: candidate.item.thumbnail,
        source: candidate.item.source || candidate.sourceHost,
      });
    }

    return results;
  } catch (error) {
    console.error("SerpAPI image search error:", error);
    return fallbackImageSearch(query, count);
  }
}

async function searchSerpAPIVideos(query: string, count: number, apiKey: string): Promise<VideoResult[]> {
  try {
    const params = new URLSearchParams({ q: query, api_key: apiKey, engine: "google_videos", num: String(Math.min(count + 14, 36)) });
    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    if (!response.ok) throw new Error(`SerpAPI videos error: ${response.status}`);
    const data = await response.json();

    const tokens = tokenizeQuery(query);
    const candidates = (Array.isArray(data.video_results) ? data.video_results : [])
      .map((item: any) => {
        const url = item.link;
        const thumbnail = item.thumbnail?.static || item.thumbnail || "";
        const title = item.title || query;
        const relevanceText = `${title} ${item.source || ""} ${url || ""}`;
        return {
          item,
          url,
          thumbnail,
          title,
          score: relevanceScore(relevanceText, tokens),
        };
      })
      .filter((candidate: any) => candidate.url && candidate.thumbnail)
      .sort((a: any, b: any) => b.score - a.score);

    const results: VideoResult[] = [];

    for (const candidate of candidates) {
      if (results.length >= count) break;
      if (tokens.length > 0 && candidate.score <= 0 && results.length > 0) continue;

      const thumbnailReachable = await isReachableMedia(candidate.thumbnail, "image");
      if (!thumbnailReachable) continue;

      results.push({
        title: candidate.title,
        url: candidate.url,
        thumbnail: candidate.thumbnail,
        duration: candidate.item.duration,
        source: candidate.item.source || safeHostname(candidate.url) || "Video",
      });
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

function fallbackImageSearch(query: string, _count: number): ImageResult[] {
  console.warn(`Image fallback unavailable for query: ${query}`);
  return [];
}

function fallbackVideoSearch(query: string, _count: number): VideoResult[] {
  console.warn(`Video fallback unavailable for query: ${query}`);
  return [];
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

async function isReachableMedia(url: string, type: "image" | "video"): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "Range": "bytes=0-1024" },
    });
    clearTimeout(timeout);

    if (!response.ok) return false;

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (type === "image") {
      return contentType.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(url);
    }
    return contentType.startsWith("video/") || contentType.includes("text/html");
  } catch {
    return false;
  }
}
