import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple in-memory LRU cache (per warm instance) — cuts Firecrawl spend on repeated URLs.
const cache = new Map<string, { at: number; data: any }>();
const TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

function getCached(url: string) {
  const hit = cache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(url);
    return null;
  }
  return hit.data;
}

function putCached(url: string, data: any) {
  if (cache.size > 200) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(url, { at: Date.now(), data });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return new Response(JSON.stringify({ error: "Invalid url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cached = getCached(url);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "FIRECRAWL_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["summary", "screenshot"],
        onlyMainContent: true,
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      console.error("Firecrawl error:", res.status, json);
      return new Response(JSON.stringify({ error: json?.error || "Firecrawl failed" }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = json?.data || json;
    const meta = data?.metadata || {};
    const out = {
      url,
      title: meta.title || meta.ogTitle || new URL(url).hostname,
      description: data?.summary || meta.description || meta.ogDescription || "",
      image: meta.ogImage || data?.screenshot || null,
      site: meta.siteName || new URL(url).hostname,
      favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(url).hostname)}&sz=64`,
    };
    putCached(url, out);

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("link-preview error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
