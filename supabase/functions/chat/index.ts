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
    const { messages, fileContext, userId: _userId, timeZone, clientTimeISO } = await req.json();
    const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // Always derive user id from the JWT (prevents cross-account memory bleed)
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    let userId = "";
    if (jwt && SUPABASE_URL && SUPABASE_ANON_KEY) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      });
      const { data } = await userClient.auth.getUser();
      if (data?.user?.id) userId = data.user.id;
    }

    // Fetch user memory (service role)
    let userMemory = "";
    if (userId && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: memories } = await supabase
        .from("user_memory")
        .select("key, value")
        .eq("user_id", userId);

      if (memories && memories.length > 0) {
        userMemory =
          "\n\nUser Information (remember this about the user):\n" +
          memories.map((m) => `- ${m.key}: ${m.value}`).join("\n");
      }
    }


    // Current time context (helps prevent "living in 2023" answers)
    let timeContext = "";
    try {
      const tz = typeof timeZone === "string" && timeZone ? timeZone : undefined;
      const now = clientTimeISO ? new Date(clientTimeISO) : new Date();
      const display = tz
        ? now.toLocaleString("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : now.toUTCString();
      timeContext = `\n\nCurrent date/time for the user${tz ? ` (${tz})` : ""}: ${display}. Always use this as the "today" reference.`;
    } catch {
      // ignore
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

Be natural, helpful, and conversational. Don't be overly formal.${timeContext}${userMemory}`;


    if (fileContext) {
      systemContent += `\n\nAttachments: The user has shared files with you. ${fileContext}. Analyze and discuss them as needed.`;
    }

    // Check if any message has images - use multimodal model if so
    const hasImages = messages.some(
      (msg: { imageUrls?: string[] }) => msg.imageUrls && msg.imageUrls.length > 0
    );

    // Build messages array with image support for multimodal
    const formattedMessages = messages.map(
      (msg: { role: string; content: string; imageUrls?: string[] }) => {
        if (msg.imageUrls && msg.imageUrls.length > 0) {
          const content: Array<
            { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
          > = [{ type: "text", text: msg.content }];

          for (const url of msg.imageUrls) {
            content.push({
              type: "image_url",
              image_url: { url },
            });
          }

          return { role: msg.role, content };
        }

        return { role: msg.role, content: msg.content };
      }
    );

    // Use Mistral for text-only, Gemini for multimodal (images)
    if (hasImages) {
      // Use Lovable AI Gateway for multimodal (Gemini)
      if (!LOVABLE_API_KEY) {
        throw new Error("LOVABLE_API_KEY is not configured for image analysis");
      }

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "system", content: systemContent }, ...formattedMessages],
          stream: true,
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        throw new Error("AI service temporarily unavailable");
      }

      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // Use Mistral AI for text-only conversations
    if (!MISTRAL_API_KEY) {
      throw new Error("MISTRAL_API_KEY is not configured");
    }

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-large-latest",
        messages: [{ role: "system", content: systemContent }, ...formattedMessages],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("Mistral API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI service temporarily unavailable" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
