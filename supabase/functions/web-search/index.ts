import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  thumbnail?: string;
}

interface ImageResult {
  title: string;
  url: string;
  imageUrl: string;
  source: string;
}

interface VideoResult {
  title: string;
  url: string;
  thumbnail: string;
  duration?: string;
  source: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, type = "web", count = 5 } = await req.json();

    if (!query) {
      throw new Error("Query is required");
    }

    let results: SearchResult[] | ImageResult[] | VideoResult[] = [];

    // Use DuckDuckGo HTML search (free, no API key required)
    if (type === "web") {
      results = await searchDuckDuckGo(query, count);
    } else if (type === "images") {
      results = await searchImages(query, count);
    } else if (type === "videos") {
      results = await searchVideos(query, count);
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

async function searchDuckDuckGo(query: string, count: number): Promise<SearchResult[]> {
  try {
    // Use DuckDuckGo instant answer API
    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`
    );

    if (!response.ok) {
      throw new Error("DuckDuckGo search failed");
    }

    const data = await response.json();
    const results: SearchResult[] = [];

    // Add abstract if available
    if (data.Abstract) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL || `https://duckduckgo.com/?q=${encodedQuery}`,
        snippet: data.Abstract,
        thumbnail: data.Image || undefined,
      });
    }

    // Add related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, count - results.length)) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(" - ")[0] || topic.Text.slice(0, 60),
            url: topic.FirstURL,
            snippet: topic.Text,
            thumbnail: topic.Icon?.URL || undefined,
          });
        }
      }
    }

    // If no results, provide a search link
    if (results.length === 0) {
      results.push({
        title: `Search results for "${query}"`,
        url: `https://duckduckgo.com/?q=${encodedQuery}`,
        snippet: `Click to see full search results for "${query}" on DuckDuckGo.`,
      });
    }

    return results.slice(0, count);
  } catch (error) {
    console.error("DuckDuckGo search error:", error);
    return [{
      title: `Search "${query}"`,
      url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      snippet: `Search for "${query}" on DuckDuckGo`,
    }];
  }
}

async function searchImages(query: string, count: number): Promise<ImageResult[]> {
  try {
    // Use DuckDuckGo image search API
    const encodedQuery = encodeURIComponent(query);
    const vqd = await getVQD(query);
    
    if (!vqd) {
      // Fallback to providing direct links
      return [{
        title: query,
        url: `https://duckduckgo.com/?q=${encodedQuery}&iax=images&ia=images`,
        imageUrl: `https://via.placeholder.com/400x300?text=${encodedQuery}`,
        source: "DuckDuckGo Images",
      }];
    }

    const response = await fetch(
      `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodedQuery}&vqd=${vqd}&f=,,,,,&p=1`,
      {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );

    if (!response.ok) {
      throw new Error("Image search failed");
    }

    const data = await response.json();
    const results: ImageResult[] = [];

    if (data.results) {
      for (const item of data.results.slice(0, count)) {
        results.push({
          title: item.title || query,
          url: item.url || item.image,
          imageUrl: item.image || item.thumbnail,
          source: item.source || new URL(item.url || item.image).hostname,
        });
      }
    }

    return results;
  } catch (error) {
    console.error("Image search error:", error);
    const encodedQuery = encodeURIComponent(query);
    return [{
      title: query,
      url: `https://duckduckgo.com/?q=${encodedQuery}&iax=images&ia=images`,
      imageUrl: `https://via.placeholder.com/400x300?text=${encodedQuery}`,
      source: "DuckDuckGo Images",
    }];
  }
}

async function searchVideos(query: string, count: number): Promise<VideoResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const vqd = await getVQD(query);
    
    if (!vqd) {
      return [{
        title: query,
        url: `https://www.youtube.com/results?search_query=${encodedQuery}`,
        thumbnail: `https://via.placeholder.com/480x360?text=${encodedQuery}`,
        source: "YouTube",
      }];
    }

    const response = await fetch(
      `https://duckduckgo.com/v.js?l=us-en&o=json&q=${encodedQuery}&vqd=${vqd}&f=,,,,,&p=1`,
      {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );

    if (!response.ok) {
      throw new Error("Video search failed");
    }

    const data = await response.json();
    const results: VideoResult[] = [];

    if (data.results) {
      for (const item of data.results.slice(0, count)) {
        results.push({
          title: item.title || query,
          url: item.content || item.url,
          thumbnail: item.images?.large || item.images?.medium || item.images?.small || "",
          duration: item.duration,
          source: item.publisher || new URL(item.content || item.url).hostname,
        });
      }
    }

    return results;
  } catch (error) {
    console.error("Video search error:", error);
    const encodedQuery = encodeURIComponent(query);
    return [{
      title: query,
      url: `https://www.youtube.com/results?search_query=${encodedQuery}`,
      thumbnail: `https://via.placeholder.com/480x360?text=${encodedQuery}`,
      source: "YouTube",
    }];
  }
}

async function getVQD(query: string): Promise<string | null> {
  try {
    const response = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const html = await response.text();
    const match = html.match(/vqd=['"]([^'"]+)['"]/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
