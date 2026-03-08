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
- Be clear, natural, and grounded
- Keep greetings short and human (no exaggerated hype or roleplay unless user asks)
- Prefer concise paragraphs over rigid templates
- Use bullets only when they improve clarity
- Match the user's tone without being cheesy
- When the user's message has a clear emotional tone (humor, excitement, gratitude, sadness), you may include ONE relevant GIF using [GIF:keyword]
- Only use GIFs when they truly fit the moment — do NOT force them`,

  highly_courteous: `
PERSONALITY MODE: Highly Courteous
- Be exceptionally warm, friendly, and expressive
- Show genuine enthusiasm and care for the user
- Use emojis occasionally to add warmth 😊
- Adapt your tone to match the user's mood
- Actively scan the user's message for emotional cues and include 1-2 GIFs using [GIF:keyword] when appropriate
- GIF keyword examples: laughing, happy, sad, love, thank you, celebration, hug, excited, party, thumbs up, surprised, angry, cool, wave, bye, fire, thinking
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

// Web search intent patterns - expanded for better detection
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
  /(?:current|live|latest|today'?s?) (?:score|scores|result|results|standings?|match|game) (?:of |for |in |between )?(.+)/i,
  /(?:what|who) (?:is|are|was|were) (.+?) (?:playing|facing|going against|matched with)/i,
  /(?:next|upcoming) (?:match|game|fixture) (?:of |for )?(.+)/i,
  /(?:score|result)s? (?:of |for |in )?(.+)/i,
];

const IMAGE_FETCH_PATTERNS = [
  /show me (?:an? )?(?:image|picture|photo)s? of (.+)/i,
  /(?:can you |please )?(?:find|get|fetch) (?:an? )?(?:image|picture|photo)s? of (.+)/i,
  /what does (.+) look like/i,
  /images? of (.+)/i,
];

const VIDEO_FETCH_PATTERNS = [
  /show me (?:a )?video(?:s)? (?:of |about |on )?(.+)/i,
  /(?:find|get|search for) (?:a )?video(?:s)? (?:of |about |on )?(.+)/i,
  /video(?:s)? (?:of |about |on )(.+)/i,
  /(?:can you |please )?(?:find|get) (?:a )?video (?:tutorial|guide)? (?:on |about |for )?(.+)/i,
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

// Video generation detection
const VIDEO_GENERATION_PATTERNS = [
  /^generate (?:a |me )?(?:video|clip|animation)/i,
  /^create (?:a |me )?(?:video|clip|animation)/i,
  /^make (?:me )?(?:a )?(?:video|clip|animation)/i,
  /^(?:can you |please )?(?:generate|create|make) (?:a )?(?:video|clip|animation)/i,
];

const STYLE_KEYWORDS = ['sketch', 'anime', 'cinematic', 'photoreal', 'realistic', 'cartoon', 'painting', 'watercolor', 'oil painting', '3d render'];

// Detect if user is asking about real-time/current events that need fresh web data
function needsFreshWebSearch(text: string): boolean {
  const realTimePatterns = [
    /(?:current|live|today|right now|ongoing|latest|recent)/i,
    /(?:score|scores|result|results|standings|match|game|fixture)/i,
    /(?:weather|temperature|forecast)/i,
    /(?:stock|price|market|trading)/i,
    /(?:news|headline|breaking)/i,
    /(?:who (?:is|are) .+ playing|next match|upcoming game)/i,
    /(?:what time|when does|schedule)/i,
  ];
  return realTimePatterns.some(p => p.test(text));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, fileContext, timeZone, clientTimeISO, aiMode, followUpQuestions, isVoiceMode, noStream, forceWebSearch, webSearchQuery } = await req.json();
    const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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
    let videoContext = "";
    let webSources: Array<{ title: string; url: string }> = [];
    let shouldGenerateImage = false;
    let shouldGenerateVideo = false;
    let imagePrompt = "";
    let videoPrompt = "";
    let detectedStyle = "photoreal";

    // Check for image generation request
    for (const pattern of IMAGE_GENERATION_PATTERNS) {
      if (pattern.test(lastContent)) {
        shouldGenerateImage = true;
        imagePrompt = lastContent
          .replace(/^(generate|create|make|draw|visuali[sz]e)\s*(me\s*)?(an?\s*)?(image|picture|photo|illustration|art|artwork)?\s*(of\s*)?/i, '')
          .trim() || lastContent;
        
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

    // Check for video generation request
    if (!shouldGenerateImage) {
      for (const pattern of VIDEO_GENERATION_PATTERNS) {
        if (pattern.test(lastContent)) {
          shouldGenerateVideo = true;
          videoPrompt = lastContent
            .replace(/^(generate|create|make)\s*(me\s*)?(a\s*)?(video|clip|animation)?\s*(of\s*)?/i, '')
            .trim() || lastContent;
          break;
        }
      }
    }

    // Check for web search intent (only if not generating image or video)
    if (!shouldGenerateImage && !shouldGenerateVideo) {
      const shouldForceSearch = Boolean(forceWebSearch);
      const forcedQuery = typeof webSearchQuery === "string" && webSearchQuery.trim()
        ? webSearchQuery.trim()
        : lastContent;
      const isRealTimeQuery = needsFreshWebSearch(lastContent);
      let searchTriggered = false;

      for (const pattern of WEB_SEARCH_PATTERNS) {
        const match = lastContent.match(pattern);
        if (!match) continue;

        const query = (match[1] || forcedQuery).trim();
        try {
          const searchResults = await performWebSearch(SUPABASE_URL!, query, "web");
          if (searchResults.length > 0) {
            webSources = searchResults
              .filter((r: any) => r?.url)
              .map((r: any) => ({ title: r.title || r.url, url: r.url }));
            searchContext = `\n\n[Web Search Results for "${query}" - USE THESE AS YOUR PRIMARY SOURCE OF TRUTH]:\n` +
              searchResults.map((r: any, i: number) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   Source: ${r.url}`).join("\n\n");
          }
        } catch (e) {
          console.error("Web search error:", e);
        }
        searchTriggered = true;
        break;
      }

      if (!searchTriggered && (isRealTimeQuery || shouldForceSearch)) {
        try {
          const searchResults = await performWebSearch(SUPABASE_URL!, forcedQuery, "web");
          if (searchResults.length > 0) {
            webSources = searchResults
              .filter((r: any) => r?.url)
              .map((r: any) => ({ title: r.title || r.url, url: r.url }));
            searchContext = `\n\n[Web Search Results for "${forcedQuery}" - USE THESE AS YOUR PRIMARY SOURCE OF TRUTH]:\n` +
              searchResults.map((r: any, i: number) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   Source: ${r.url}`).join("\n\n");
          }
        } catch (e) {
          console.error("Auto web search error:", e);
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

      // Check for video fetch intent
      for (const pattern of VIDEO_FETCH_PATTERNS) {
        const match = lastContent.match(pattern);
        if (match) {
          const query = match[1].trim();
          try {
            const videoResults = await performWebSearch(SUPABASE_URL!, query, "videos");
            if (videoResults.length > 0) {
              videoContext = `\n\n[Web Videos for "${query}" - display these as video cards with thumbnails]:\n` +
                videoResults.slice(0, 4).map((r: any, i: number) => 
                  `${i + 1}. [VIDEO_CARD:${r.title}|${r.url}|${r.thumbnail}|${r.duration || ''}|${r.source || 'YouTube'}]`
                ).join("\n");
            }
          } catch (e) {
            console.error("Video search error:", e);
          }
          break;
        }
      }
    }

    // Get mode-specific prompt
    const modePrompt = MODE_PROMPTS[aiMode] || MODE_PROMPTS['smart_friendly'];
    const voiceRestrictions = isVoiceMode ? VOICE_MODE_RESTRICTIONS : '';
    const followUpInstruction = followUpQuestions 
      ? '\n- When appropriate, ask thoughtful follow-up questions.'
      : '\n- Do NOT ask follow-up questions unless absolutely necessary.';

    // Build system prompt
    let systemContent = `You are Astraz, an intelligent AI assistant created by X-Tech.

About X-Tech:
- Founded September 29th, 2023 by Khaleel Abdallah, a 15-year-old high schooler from Nigeria
- Currently owns Astraz and WishVerse
- WishVerse is a wish-making platform

About You (Astraz):
- Your name is Astraz — always refer to yourself as Astraz
- You are a helpful, friendly AI assistant
- You have NEVER been called "X-AI" or any other name — you have always been Astraz
- If asked about your name or identity, say you are Astraz, created by X-Tech
- Access to real-time web search and image finding

ASTRAZ APP FEATURES (use this to help users navigate):
- Voice Call: Users can call you by tapping the phone icon. They can choose from 16 voices (8 feminine, 8 masculine)
- Image Generation: Users can generate images via the + menu > Generate Image, or by asking "generate an image of..."
- Video Generation: Available via the + menu > Generate Video (requires Basic tier or above)
- Web Search: You automatically search the web for real-time info. Users can also say "search for..."
- File Attachments: Users can attach files via the + menu > Attach File
- Themes: Dark and light mode available in profile settings (tap avatar)
- Voice Settings: Users can change your voice in profile settings
- Subscription Tiers: Free (5 images/day), Basic (10 images, 2 videos), Pro (25 images, 8 videos), Ultimate (unlimited)
- Promo Codes: Users can redeem codes on the subscription/payment page
- Memory: You remember things users tell you across conversations
- Conversation History: All chats are saved in the sidebar
${modePrompt}${voiceRestrictions}${followUpInstruction}

IMPORTANT RESPONSE GUIDELINES:
1. Do NOT force section labels like "Quick answer", "Details", or "Next step" unless the user explicitly asks for that structure.
2. Open with a direct answer first, then add concise supporting context only if needed.
3. Keep paragraph spacing clean: short paragraphs (1-3 sentences), readable line breaks, and tight flow.
4. Use bullets or numbering only when listing multiple items; keep numbering sequential.
5. CODE: Always wrap in triple backticks with language name.
6. LINKS: Use markdown format [text](url) — keep URLs short, never paste raw long URLs.
7. IMAGES FROM WEB: Use ONLY clean markdown image syntax ![alt](https://...) and never output rendering directives, transform snippets, or partial URL fragments.
8. VIDEOS FROM WEB: Format as [VIDEO_CARD:title|url|thumbnail|duration|source].
9. TABLES: Use compact 2-5 column tables only when comparison is necessary; otherwise prefer bullets.
10. WEB SEARCH RESULTS: Always cite sources at the end with a [Sources] section using numbered markdown links.
11. REAL-TIME DATA: When search results are provided, treat them as primary truth and do not invent facts.${timeContext}${userMemory}${searchContext}${mediaContext}${videoContext}`;

    if (webSources.length > 0) {
      const forcedSources = webSources
        .slice(0, 5)
        .map((source, index) => `${index + 1}. [${source.title}](${source.url})`)
        .join("\n");

      systemContent += `\n\nMANDATORY: You MUST append this exact block at the end of your answer (do not skip it):\n[Sources]\n${forcedSources}`;
    }

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

    // Check if any message has images
    const hasImages = messages.some(
      (msg: { imageUrls?: string[] }) => msg.imageUrls && msg.imageUrls.length > 0
    );

    // Check if any message has videos
    const hasVideos = messages.some(
      (msg: { videoUrls?: string[] }) => msg.videoUrls && msg.videoUrls.length > 0
    );

    const isGifUrl = (url: string) => /\.gif(\?.*)?$/i.test(url) || /giphy|tenor/i.test(url);
    const hasGifs = messages.some(
      (msg: { imageUrls?: string[] }) => (msg.imageUrls || []).some((url) => isGifUrl(url))
    );

    // Build messages array
    const formattedMessages = messages.map(
      (msg: { role: string; content: string; imageUrls?: string[]; videoUrls?: string[] }) => {
        if ((msg.imageUrls && msg.imageUrls.length > 0) || (msg.videoUrls && msg.videoUrls.length > 0)) {
          const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
            { type: "text", text: msg.content }
          ];
          for (const url of (msg.imageUrls || [])) {
            content.push({ type: "image_url", image_url: { url } });
          }
          // Video/GIF URLs are handled via Gemini when applicable
          return { role: msg.role, content };
        }
        return { role: msg.role, content: msg.content };
      }
    );

    // === VIDEO/GIF ANALYSIS VIA GEMINI ===
    if (hasVideos || hasGifs) {
      const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
      if (!GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not configured for video analysis");
      }

      // Collect video/GIF URLs from the last user message
      const lastMsg = messages[messages.length - 1];
      const videoUrls: string[] = lastMsg?.videoUrls || [];
      const gifUrls: string[] = (lastMsg?.imageUrls || []).filter((url: string) => isGifUrl(url));
      const mediaUrls = [...videoUrls, ...gifUrls];

      if (mediaUrls.length > 0) {
        // Upload each media file to Gemini Files API and get file URIs
        const fileUris: Array<{ uri: string; mimeType: string }> = [];
        for (const mediaUrl of mediaUrls) {
          try {
            // Download media
            const mediaRes = await fetch(mediaUrl);
            if (!mediaRes.ok) {
              console.error("Failed to download media:", mediaUrl);
              continue;
            }
            const mediaBytes = await mediaRes.arrayBuffer();
            const fallbackMime = isGifUrl(mediaUrl) ? "image/gif" : "video/mp4";
            const contentType = mediaRes.headers.get("content-type") || fallbackMime;

            // Upload to Gemini Files API (resumable)
            const startRes = await fetch(
              `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`,
              {
                method: "POST",
                headers: {
                  "X-Goog-Upload-Protocol": "resumable",
                  "X-Goog-Upload-Command": "start",
                  "X-Goog-Upload-Header-Content-Length": String(mediaBytes.byteLength),
                  "X-Goog-Upload-Header-Content-Type": contentType,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ file: { display_name: "user-media" } }),
              }
            );

            const uploadUrl = startRes.headers.get("x-goog-upload-url");
            if (!uploadUrl) {
              console.error("Failed to get upload URL from Gemini");
              continue;
            }

            // Upload bytes
            const uploadRes = await fetch(uploadUrl, {
              method: "POST",
              headers: {
                "Content-Length": String(mediaBytes.byteLength),
                "X-Goog-Upload-Offset": "0",
                "X-Goog-Upload-Command": "upload, finalize",
              },
              body: mediaBytes,
            });

            const fileInfo = await uploadRes.json();
            const fileUri = fileInfo?.file?.uri;
            if (fileUri) {
              fileUris.push({ uri: fileUri, mimeType: contentType });

              // Wait for processing (mostly needed for video)
              const fileName = fileInfo.file.name;
              let state = fileInfo.file.state;
              let attempts = 0;
              while (state === "PROCESSING" && attempts < 30) {
                await new Promise(r => setTimeout(r, 2000));
                const checkRes = await fetch(
                  `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_API_KEY}`
                );
                const checkData = await checkRes.json();
                state = checkData.state;
                attempts++;
              }
              if (state !== "ACTIVE") {
                console.error("Media processing timed out or failed:", state);
              }
            }
          } catch (err) {
            console.error("Media upload error:", err);
          }
        }

        if (fileUris.length > 0) {
          // Build Gemini request with uploaded media file URIs
          const geminiParts: any[] = [];
          for (const file of fileUris) {
            geminiParts.push({ fileData: { mimeType: file.mimeType, fileUri: file.uri } });
          }
          geminiParts.push({ text: lastMsg.content || "Analyze this media and describe what you see." });

          const geminiMessages = [
            { role: "user", parts: [{ text: systemContent }] },
            { role: "model", parts: [{ text: "Understood. I'm Astraz and will follow these guidelines." }] },
          ];

          // Add conversation history (text only)
          for (const msg of formattedMessages.slice(0, -1)) {
            const role = msg.role === "assistant" ? "model" : "user";
            const text = typeof msg.content === "string" ? msg.content : 
              (Array.isArray(msg.content) ? msg.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n") : "");
            if (text) geminiMessages.push({ role, parts: [{ text }] });
          }

          // Add the video + user message
          geminiMessages.push({ role: "user", parts: geminiParts });

          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: geminiMessages,
                generationConfig: { maxOutputTokens: 2048 },
              }),
            }
          );

          if (!geminiRes.ok) {
            const errText = await geminiRes.text();
            console.error("Gemini video analysis error:", geminiRes.status, errText);
            throw new Error("Video analysis failed");
          }

          const geminiData = await geminiRes.json();
          const responseText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't analyze the video.";

          // Return as SSE stream format for consistency
          const encoder = new TextEncoder();
          const ssePayload = `data: ${JSON.stringify({ choices: [{ delta: { content: responseText } }] })}\n\ndata: [DONE]\n\n`;

          return new Response(encoder.encode(ssePayload), {
            headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
          });
        }
      }
    }

    if (hasImages) {
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
          model: "pixtral-large-latest",
          messages: [{ role: "system", content: systemContent }, ...formattedMessages],
          stream: true,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error("Mistral Pixtral error:", response.status, errBody);
        if (response.status === 429) {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        console.warn("Pixtral failed, falling back to text-only...");
        const textOnlyMessages = formattedMessages.map((msg: any) => {
          if (Array.isArray(msg.content)) {
            const textParts = msg.content.filter((p: any) => p.type === 'text');
            return { role: msg.role, content: textParts.map((p: any) => p.text).join('\n') + '\n[Note: User attached image(s) but image analysis is temporarily unavailable]' };
          }
          return msg;
        });

        const fallbackRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${MISTRAL_API_KEY}`, "Content-Type": "application/json" },
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
        throw new Error("AI service temporarily unavailable. Please try again.");
      }

      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    if (!MISTRAL_API_KEY) {
      throw new Error("MISTRAL_API_KEY is not configured");
    }

    // Voice mode: use faster model for near-instant responses
    const useStream = isVoiceMode ? true : !noStream;
    const voiceModel = "mistral-small-latest"; // Much faster TTFT than large
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: isVoiceMode ? voiceModel : "mistral-large-latest",
        messages: [{ role: "system", content: systemContent }, ...formattedMessages],
        stream: useStream,
        ...(isVoiceMode ? { max_tokens: 150 } : noStream ? { max_tokens: 300 } : {}),
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

    if (!useStream) {
      const data = await response.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      body: JSON.stringify({ query, type, count: type === "images" ? 8 : type === "videos" ? 6 : 5 }),
    });

    if (!response.ok) throw new Error("Search failed");
    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error("Search helper error:", error);
    return [];
  }
}
