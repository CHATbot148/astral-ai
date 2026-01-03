import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, fileContext, userId } = await req.json();
    const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!MISTRAL_API_KEY) {
      throw new Error("MISTRAL_API_KEY is not configured");
    }

    // Fetch user memory if userId is provided
    let userMemory = "";
    if (userId && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: memories } = await supabase
        .from('user_memory')
        .select('key, value')
        .eq('user_id', userId);
      
      if (memories && memories.length > 0) {
        userMemory = "\n\nUser Information (remember this about the user):\n" + 
          memories.map(m => `- ${m.key}: ${m.value}`).join("\n");
      }
    }

    // X-AI identity system prompt
    let systemContent = `You are X-AI, an intelligent AI assistant created by X-Tech.

About X-Tech:
- X-Tech is a software and technology company founded on September 29th, 2023
- X-Tech was founded by Khaleel Abdallah, a 15-year-old high schooler from Nigeria
- X-Tech currently owns and operates X-AI and WishVerse
- Khaleel Abdallah is the inventor of all X-Tech creations

About You (X-AI):
- You are X-AI, the AI assistant product of X-Tech
- You are helpful, friendly, and conversational
- You can generate images when users ask (e.g., "generate an image of...", "create an image of...", "make me a picture of...")
- When users want to generate images, acknowledge that you can do this and the image will be generated for them

Be natural, helpful, and conversational. Don't be overly formal.${userMemory}`;

    if (fileContext) {
      systemContent += `\n\nAttachments: The user has shared files with you. ${fileContext}. Analyze and discuss them as needed.`;
    }

    // Build messages array with image support for Mistral
    const formattedMessages = messages.map((msg: { role: string; content: string; imageUrls?: string[] }) => {
      // If there are image URLs, format as multimodal content for Mistral
      if (msg.imageUrls && msg.imageUrls.length > 0) {
        const content: { type: string; text?: string; image_url?: string }[] = [
          { type: "text", text: msg.content }
        ];
        
        for (const url of msg.imageUrls) {
          content.push({
            type: "image_url",
            image_url: url
          });
        }
        
        return { role: msg.role, content };
      }
      
      return { role: msg.role, content: msg.content };
    });

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-large-latest",
        messages: [
          { role: "system", content: systemContent },
          ...formattedMessages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402 || response.status === 401) {
        return new Response(JSON.stringify({ error: "API key issue. Please check your Mistral API key." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("Mistral API error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI service temporarily unavailable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
