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
     const { query, limit = 1, mood } = await req.json();
     const GIPHY_API_KEY = Deno.env.get("GIPHY_API_KEY");
 
     if (!GIPHY_API_KEY) {
       throw new Error("GIPHY_API_KEY is not configured");
     }
 
     // If mood is provided, search by mood keyword
     const searchTerm = mood || query || "fun";
     
     const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(searchTerm)}&limit=${limit}&rating=pg-13`;
     
     const response = await fetch(url);
     
     if (!response.ok) {
       throw new Error(`Giphy API error: ${response.status}`);
     }
 
     const data = await response.json();
     
     // Extract GIF URLs
     const gifs = data.data.map((gif: any) => ({
       id: gif.id,
       url: gif.images.fixed_height.url,
       title: gif.title,
       width: gif.images.fixed_height.width,
       height: gif.images.fixed_height.height,
     }));
 
     return new Response(JSON.stringify({ gifs }), {
       headers: { ...corsHeaders, "Content-Type": "application/json" },
     });
   } catch (error) {
     console.error("Giphy fetch error:", error);
     return new Response(
       JSON.stringify({ error: error instanceof Error ? error.message : "Failed to fetch GIF" }),
       { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
     );
   }
 });