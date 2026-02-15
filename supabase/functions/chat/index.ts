import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// AI Mode system prompts
const MODE_PROMPTS: Record<string, string> = {
  professional: `
PERSONALITY MODE: Professional
- Be extremely concise and direct. No fluff.
- Avoid small talk, pleasantries like "Great question!" or "How's your day?"
- Get straight to the point with factual, efficient responses
- Use bullet points and structured formats
- Maintain a business-like tone without being cold
- Focus purely on delivering accurate, helpful information
- Do NOT ask unnecessary follow-up questions unless critical
- NO emojis, NO GIFs, NO bold text for emphasis`,

  smart_friendly: `
PERSONALITY MODE: Smart & Friendly (Default)
- Be helpful, friendly, and conversational
- Strike a balance between warmth and efficiency
- Engage naturally without being overly formal or too casual
- Be encouraging and supportive while staying on topic`,

  highly_courteous: `
PERSONALITY MODE: Highly Courteous
- Be exceptionally warm, friendly, and expressive
- Show genuine enthusiasm and care for the user
- Use emojis occasionally to add warmth 😊
- Adapt your tone to match the user's mood
- When the mood calls for it, include GIFs using: [GIF:keyword]
- GIF triggers (use sparingly, max 2 per message):
  * User says something funny → [GIF:laughing]
  * User is bored → [GIF:party]
  * User thanks you → [GIF:thank you]
  * User accomplishes something → [GIF:celebration]
  * User is sad → [GIF:hug]
  * General excitement → [GIF:excited]
- Be encouraging and supportive
- Make the conversation feel like chatting with a caring friend`,
};

// Voice mode restrictions
const VOICE_MODE_RESTRICTIONS = `
VOICE MODE ACTIVE - STRICT FORMATTING RULES:
- Use ONLY plain text with punctuation marks
- NO emojis whatsoever
- NO GIFs or [GIF:...] tags
- NO bold text (**text**) or italic (*text*)
- NO markdown formatting
- Keep responses conversational and natural for speech
- Numbers should be written as words when short (one, two, three)
`;

// Web search intent patterns
const WEB_SEARCH_PATTERNS = [
  /search (?:for |the web for |online for )?(.+)/i,
  /look up (.+)/i,
  /find (?:information |info )?(?:about |on )?(.+)/i,
  /what(?:'s| is) the latest (?:news |info )?(?:on |about )?(.+)/i,
  /(?:can you |please )?google (.+)/i,
  /what(?:'s| is) happening (?:with |in )?(.+)/i,
  /who is (.+)/i,
  /when (?:is|was|did) (.+)/i,
  /where (?:is|was|can I find) (.+)/i,
];

const IMAGE_FETCH_PATTERNS = [
  /show me (?:an? )?(?:image|picture|photo)s? of (.+)/i,
  /(?:can you |please )?(?:find|get|fetch) (?:an? )?(?:image|picture|photo)s? of (.+)/i,
  /what does (.+) look like/i,
  /images? of (.+)/i,
];

// Image generation detection - be very specific
const IMAGE_GENERATION_PATTERNS = [
  /^generate (?:an? |me )?(?:image|picture|photo|illustration|art)/i,
  /^create (?:an? |me )?(?:image|picture|photo|illustration|art)/i,
  /^make (?:me )?(?:an? )?(?:image|picture|photo|illustration)/i,
  /^draw (?:me )?(?:an? )?(.+)/i,
  /^visuali[sz]e (.+)/i,
  /^(?:can you |please )?(?:generate|create|make|draw) (?:an? )?(?:image|picture|photo|illustration)/i,
];

// Style keywords for image generation
const STYLE_KEYWORDS = ['sketch', 'anime', 'cinematic', 'photoreal', 'realistic', 'cartoon', 'painting', 'watercolor', 'oil painting', '3d render'];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, fileContext, timeZone, clientTimeISO, aiMode, followUpQuestions, isVoiceMode } = await req.json();
    const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // Derive user id from JWT
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

    // Fetch user memory
    let userMemory = "";
    if (userId && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: memories } = await supabase
        .from("user_memory")
        .select("key, value")
        .eq("user_id", userId);

      if (memories && memories.length > 0) {
        userMemory =
          "\n\nUser Information (facts they've shared with you):\n" +
          memories.map((m) => `- ${m.key}: ${m.value}`).join("\n");
      }
    }

    // Current time context
    let timeContext = "";
    try {
      const tz = typeof timeZone === "string" && timeZone ? timeZone : undefined;
      const now = clientTimeISO ? new Date(clientTimeISO) : new Date();
      const display = tz
        ? now.toLocaleString("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : now.toUTCString();
      timeContext = `\n\nCurrent date/time for the user${tz ? ` (${tz})` : ""}: ${display}.`;
    } catch {
      // ignore
    }

    // Get last user message
    const lastUserMessage = messages.filter((m: { role: string }) => m.role === "user").pop();
    const lastContent = lastUserMessage?.content || "";
    
    let searchContext = "";
    let mediaContext = "";
    let shouldGenerateImage = false;
    let imagePrompt = "";
    let detectedStyle = "photoreal";

    // Check for image generation request - be very strict
    for (const pattern of IMAGE_GENERATION_PATTERNS) {
      if (pattern.test(lastContent)) {
        shouldGenerateImage = true;
        // Extract prompt by removing the trigger words
        imagePrompt = lastContent
          .replace(/^(generate|create|make|draw|visuali[sz]e)\s*(me\s*)?(an?\s*)?(image|picture|photo|illustration|art|artwork)?\s*(of\s*)?/i, '')
          .trim() || lastContent;
        
        // Detect style from content
        for (const style of STYLE_KEYWORDS) {
          if (lastContent.toLowerCase().includes(style)) {
            if (style === 'sketch') detectedStyle = 'sketch';
            else if (style === 'anime' || style === 'cartoon') detectedStyle = 'anime';
            else if (style === 'cinematic') detectedStyle = 'cinematic';
            else detectedStyle = 'photoreal';
            break;
          }
        }
        break;
      }
    }

    // Check for web search intent (only if not generating image)
    if (!shouldGenerateImage) {
      for (const pattern of WEB_SEARCH_PATTERNS) {
        const match = lastContent.match(pattern);
        if (match) {
          const query = match[1].trim();
          try {
            const searchResults = await performWebSearch(SUPABASE_URL!, query, "web");
            if (searchResults.length > 0) {
              searchContext = `\n\n[Web Search Results for "${query}"]:\n` +
                searchResults.map((r: any, i: number) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   Source: ${r.url}`).join("\n\n");
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
              mediaContext = `\n\n[Web Images for "${query}" - display these in a scrollable grid]:\n` +
                imageResults.slice(0, 5).map((r: any, i: number) => `${i + 1}. ![${r.title}](${r.imageUrl})`).join("\n");
            }
          } catch (e) {
            console.error("Image search error:", e);
          }
          break;
        }
      }
    }

    // Get mode-specific prompt
    const modePrompt = MODE_PROMPTS[aiMode] || MODE_PROMPTS['smart_friendly'];
    
    // Voice mode restrictions
    const voiceRestrictions = isVoiceMode ? VOICE_MODE_RESTRICTIONS : '';
    
    // Follow-up questions instruction
    const followUpInstruction = followUpQuestions 
      ? '\n- When appropriate, ask thoughtful follow-up questions.'
      : '\n- Do NOT ask follow-up questions unless absolutely necessary.';

    // Build system prompt
    let systemContent = `You are X-AI, an intelligent AI assistant created by X-Tech.

About X-Tech:
- Founded September 29th, 2023 by Khaleel Abdallah, a 15-year-old high schooler from Nigeria
- Currently owns X-AI and WishVerse
- WishVerse is a wish-making platform

About You (X-AI):
- Helpful, friendly AI assistant
- Access to real-time web search and image finding
${modePrompt}${voiceRestrictions}${followUpInstruction}

IMPORTANT RESPONSE GUIDELINES:
1. BE CONCISE: Short answers for simple questions.
2. STRUCTURE: Break long text into readable paragraphs with spacing.
3. PROPER NUMBERING: Use sequential numbers (1, 2, 3...) not repeating 1.
4. CODE: Always wrap in triple backticks with language name.
5. LINKS: Use markdown format [text](url)
6. IMAGES FROM WEB: Format as ![description](url) - NEVER put 2+ images on same line
7. GIFs: Max 2 per message, NEVER show the URL as text, only the image
8. Each paragraph should have a blank line before it for readability${timeContext}${userMemory}${searchContext}${mediaContext}`;

    // Add image generation guidance if detected
    if (shouldGenerateImage) {
      systemContent += `\n\n[IMAGE GENERATION REQUEST DETECTED]
The user wants to generate an image: "${imagePrompt}"
Style detected: ${detectedStyle}
Respond with: "I'm generating that image for you now! ✨" followed by [GENERATE_IMAGE:${imagePrompt}]
Keep response brief.`;
    }

    if (fileContext) {
      systemContent += `\n\nAttachments: ${fileContext}. Analyze and discuss them as needed.`;
    }

    // Check if any message has images - use multimodal model if so
    const hasImages = messages.some(
      (msg: { imageUrls?: string[] }) => msg.imageUrls && msg.imageUrls.length > 0
    );

    // Build messages array
    const formattedMessages = messages.map(
      (msg: { role: string; content: string; imageUrls?: string[] }) => {
        if (msg.imageUrls && msg.imageUrls.length > 0) {
          const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
            { type: "text", text: msg.content }
          ];
          for (const url of msg.imageUrls) {
            content.push({ type: "image_url", image_url: { url } });
          }
          return { role: msg.role, content };
        }
        return { role: msg.role, content: msg.content };
      }
    );

    // Use Mistral AI for text-only, Gemini for multimodal
    if (hasImages) {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        throw new Error("Image analysis is not configured");
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
        const errBody = await response.text();
        console.error("Lovable AI gateway error:", response.status, errBody);
        if (response.status === 429) {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (response.status === 402) {
          return new Response(
            JSON.stringify({ error: "AI usage limit reached. Please add credits." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // Fall through to Mistral for text-only retry if multimodal fails
        console.warn("Multimodal AI failed, attempting text-only fallback...");
        const textOnlyMessages = formattedMessages.map((msg: any) => {
          if (Array.isArray(msg.content)) {
            const textParts = msg.content.filter((p: any) => p.type === 'text');
            return { role: msg.role, content: textParts.map((p: any) => p.text).join('\n') + '\n[Note: User attached image(s) but image analysis is temporarily unavailable]' };
          }
          return msg;
        });

        const MISTRAL_KEY = Deno.env.get("MISTRAL_API_KEY");
        if (MISTRAL_KEY) {
          const fallbackRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${MISTRAL_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "mistral-large-latest",
              messages: [{ role: "system", content: systemContent }, ...textOnlyMessages],
              stream: true,
            }),
          });
          if (fallbackRes.ok) {
            return new Response(fallbackRes.body, {
              headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
            });
          }
        }
        throw new Error("AI service temporarily unavailable. Please try again.");
      }

      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // Use Mistral AI for text-only
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

// Web search helper
async function performWebSearch(supabaseUrl: string, query: string, type: string): Promise<any[]> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/web-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
      body: JSON.stringify({ query, type, count: type === "images" ? 8 : 5 }),
    });

    if (!response.ok) throw new Error("Search failed");
    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error("Search helper error:", error);
    return [];
  }
}
