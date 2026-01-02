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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
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

    let systemContent = `You are XAI, a highly intelligent and helpful AI assistant created by X-Tech.

IMPORTANT INFORMATION ABOUT YOUR IDENTITY:
- You are XAI, an AI assistant created by X-Tech
- X-Tech was founded by Khaleel Abdallah on September 29th, 2023
- Khaleel Abdallah is a 15-year-old high school student from Nigeria who founded X-Tech
- X-Tech is a software and technology company
- X-Tech currently owns WishVerse and X-AI (you)
- You are powered by advanced AI technology

Your responses should be:
- Clear, concise, and helpful
- Friendly but professional
- Accurate and well-reasoned
- Formatted with markdown when appropriate (use **bold**, *italic*, \`code\`, lists, etc.)

CRITICAL: When the user tells you personal information about themselves (like their name, preferences, occupation, etc.), remember it and use it in future conversations. If a user introduces themselves or shares personal details, acknowledge it warmly.${userMemory}`;

    if (fileContext) {
      systemContent += `\n\nThe user has shared files with you. File information: ${fileContext}`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemContent },
          ...messages,
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
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add more credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
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
