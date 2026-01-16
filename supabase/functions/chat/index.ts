import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Intent detection patterns
const WEB_SEARCH_PATTERNS = [
  /search (?:for |the web for |online for )?(.+)/i,
  /look up (.+)/i,
  /find (?:information |info )?(?:about |on )?(.+)/i,
  /what(?:'s| is) the latest (?:news |info )?(?:on |about )?(.+)/i,
  /(?:can you |please )?google (.+)/i,
  /what(?:'s| is) happening (?:with |in )?(.+)/i,
  /(?:tell me about|what do you know about) (.+) (?:today|now|currently|recently)/i,
];

const IMAGE_FETCH_PATTERNS = [
  /show me (?:an? )?(?:image|picture|photo)s? of (.+)/i,
  /(?:can you |please )?(?:find|get|fetch) (?:an? )?(?:image|picture|photo)s? of (.+)/i,
  /what does (.+) look like/i,
  /(?:show|display) (?:me )?(.+) (?:image|picture|photo)s?/i,
  /i want to see (.+)/i,
];

const VIDEO_FETCH_PATTERNS = [
  /show me (?:a )?video(?:s)? (?:of |about |on )?(.+)/i,
  /(?:find|get|fetch) (?:a )?video(?:s)? (?:of |about |on )?(.+)/i,
  /video tutorial(?:s)? (?:on |about |for )?(.+)/i,
  /how to (.+) video/i,
];

const REMINDER_PATTERNS = [
  /remind me (?:to |about )?(.+) (?:at|on|in) (.+)/i,
  /set a reminder (?:for |to )?(.+) (?:at|on|in) (.+)/i,
  /message me (?:about )?(.+) (?:at|on|in) (.+)/i,
  /notify me (?:about )?(.+) (?:at|on|in) (.+)/i,
];

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

    // Fetch user memory (service role) - ONLY personal info for this specific user
    let userMemory = "";
    if (userId && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: memories } = await supabase
        .from("user_memory")
        .select("key, value")
        .eq("user_id", userId);

      if (memories && memories.length > 0) {
        userMemory =
          "\n\nUser Information (remember this about the user - these are facts they've shared with you):\n" +
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

    // Detect special intents in the last user message
    const lastUserMessage = messages.filter((m: { role: string }) => m.role === "user").pop();
    const lastContent = lastUserMessage?.content || "";
    
    let searchContext = "";
    let mediaContext = "";

    // Check for web search intent
    for (const pattern of WEB_SEARCH_PATTERNS) {
      const match = lastContent.match(pattern);
      if (match) {
        const query = match[1].trim();
        try {
          const searchResults = await performWebSearch(SUPABASE_URL!, query, "web");
          if (searchResults.length > 0) {
            searchContext = `\n\n[Web Search Results for "${query}"]:\n` +
              searchResults.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   Source: ${r.url}`).join("\n\n");
          }
        } catch (e) {
          console.error("Web search error:", e);
        }
        break;
      }
    }

    // Check for image fetch intent
    for (const pattern of IMAGE_FETCH_PATTERNS) {
      const match = lastContent.match(pattern);
      if (match) {
        const query = match[1].trim();
        try {
          const imageResults = await performWebSearch(SUPABASE_URL!, query, "images");
          if (imageResults.length > 0) {
            mediaContext = `\n\n[Images found for "${query}" - Display these to the user]:\n` +
              imageResults.map((r, i) => `${i + 1}. ![${r.title}](${r.imageUrl || r.url})\n   Source: ${r.source || r.url}`).join("\n\n");
          }
        } catch (e) {
          console.error("Image search error:", e);
        }
        break;
      }
    }

    // Check for video fetch intent
    for (const pattern of VIDEO_FETCH_PATTERNS) {
      const match = lastContent.match(pattern);
      if (match) {
        const query = match[1].trim();
        try {
          const videoResults = await performWebSearch(SUPABASE_URL!, query, "videos");
          if (videoResults.length > 0) {
            mediaContext = `\n\n[Videos found for "${query}" - Share these links with the user]:\n` +
              videoResults.map((r, i) => `${i + 1}. [${r.title}](${r.url})${r.duration ? ` (${r.duration})` : ""}\n   Source: ${r.source || "YouTube"}`).join("\n\n");
          }
        } catch (e) {
          console.error("Video search error:", e);
        }
        break;
      }
    }

    // Check for reminder intent
    for (const pattern of REMINDER_PATTERNS) {
      const match = lastContent.match(pattern);
      if (match && userId && SUPABASE_URL) {
        const reminderContent = match[1].trim();
        const timeString = match[2].trim();
        // Let AI handle the response, but mention capability
        searchContext += `\n\n[Reminder Request]: User wants to be reminded about "${reminderContent}" at "${timeString}". You can set reminders for users.`;
        break;
      }
    }

    // X-AI identity system prompt with CONCISE behavior
    let systemContent = `You are X-AI, an intelligent AI assistant created by X-Tech.

About X-Tech:
- X-Tech is a software and technology company founded on September 29th, 2023
- X-Tech was founded by Khaleel Abdallah, a 15-year-old high schooler from Nigeria
- X-Tech currently owns and operates X-AI and WishVerse
- WishVerse is a wish-making platform where users can make wishes, share them, and have them potentially granted by the community
- Khaleel Abdallah is the inventor of all X-Tech creations

About You (X-AI):
- You are X-AI, the AI assistant product of X-Tech
- You are helpful, friendly, and conversational
- You have access to real-time web search when users ask for current information
- You can find and display images and videos from the web when users request them

IMPORTANT RESPONSE GUIDELINES:
1. BE CONCISE: Keep responses short and to the point. Don't write essays for simple questions.
2. PROPER NUMBERING: When making numbered lists, use sequential numbers (1, 2, 3, 4...), NOT repeating "1." for every item.
3. CODE FORMATTING: When sharing code, ALWAYS wrap it in triple backticks with the language name, like:
\`\`\`javascript
// your code here
\`\`\`
4. LINKS: When sharing URLs, make them clickable using markdown format: [text](url)
5. MATCH RESPONSE LENGTH TO QUESTION: Short question = short answer. Only elaborate when the user asks for details.
6. Don't be overly formal or robotic. Be natural and conversational.
7. IMAGES: When showing images from search results, use markdown: ![description](url)
8. VIDEOS: When showing video results, use clickable markdown links: [Video Title](url)
9. EACH CHAT IS INDEPENDENT: Don't reference previous conversations. User's personal info (name, age, preferences) carries over, but conversation context does not.${timeContext}${userMemory}${searchContext}${mediaContext}`;

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

// Helper function to perform web search
async function performWebSearch(supabaseUrl: string, query: string, type: string): Promise<any[]> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/web-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
      body: JSON.stringify({ query, type, count: 5 }),
    });

    if (!response.ok) {
      throw new Error("Search failed");
    }

    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error("Search helper error:", error);
    return [];
  }
}
