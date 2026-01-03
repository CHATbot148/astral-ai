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
    const { prompt, aspect_ratio = "1:1" } = await req.json();
    const STABILITY_API_KEY = Deno.env.get("STABILITY_API_KEY");

    if (!STABILITY_API_KEY) {
      throw new Error("STABILITY_API_KEY is not configured");
    }

    if (!prompt) {
      throw new Error("Prompt is required");
    }

    // Use Stability AI's SDXL model
    const response = await fetch("https://api.stability.ai/v2beta/stable-image/generate/sd3", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STABILITY_API_KEY}`,
        Accept: "image/*",
      },
      body: (() => {
        const formData = new FormData();
        formData.append("prompt", prompt);
        formData.append("aspect_ratio", aspect_ratio);
        formData.append("output_format", "png");
        return formData;
      })(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Stability AI error:", response.status, errorText);
      
      if (response.status === 402) {
        throw new Error("Insufficient credits. Please add more credits to your Stability AI account.");
      }
      if (response.status === 401) {
        throw new Error("Invalid API key. Please check your Stability AI API key.");
      }
      throw new Error("Image generation failed");
    }

    // Get the image as array buffer
    const imageBuffer = await response.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));

    return new Response(
      JSON.stringify({ 
        image: `data:image/png;base64,${base64Image}` 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Image generation error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
