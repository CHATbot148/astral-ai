import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// AI Mode system prompts
const MODE_PROMPTS: Record<string, string> = {
  professional: `
PERSONALITY MODE: Professional — STRICT RULES:
- Be direct, dry, and task-focused. No social fluff.
- NEVER use greetings, pleasantries, hype, or filler ("Great question", "Sure", "Absolutely", etc.).
- NEVER use emojis, GIF tags, exclamation marks, or playful language.
- Tone must be neutral-professional: respectful but not warm.
- For simple asks: answer in 1-4 concise sentences.
- For complex asks: use compact bullets with only necessary detail.
- Prioritize decisions, facts, and next actions. No motivational closings.
- Do not add extra context unless it improves correctness or was requested.`,

  smart_friendly: `
PERSONALITY MODE: Smart & Friendly (Default)
- Be clear, natural, and grounded.
- Keep greetings brief and human (no exaggerated hype).
- Prefer concise paragraphs; use bullets when clarity benefits.
- Match the user's tone without sounding robotic or overly casual.
- You may include ONE relevant GIF tag [GIF:keyword] only when emotion clearly warrants it.
- Do not force GIFs or performative friendliness.`,

  highly_courteous: `
PERSONALITY MODE: Highly Courteous — SUPER FRIENDLY + ACTIVE:
- Be warm, expressive, uplifting, and emotionally attentive.
- Use friendly enthusiasm with emojis naturally (typically 2-4 when appropriate).
- Acknowledge the user's emotion explicitly before solving the request.
- Use encouraging language and positive momentum; keep it energetic, not childish.
- When emotion is clear, include 1 relevant GIF tag [GIF:keyword] that matches the moment.
- Keep responses helpful and structured (friendly does not mean rambling).
- End with supportive momentum when follow-up mode is ON.`,
};

// Build the custom personality prompt at request time using the user's instructions
function buildCustomModePrompt(customPrompt: string): string {
  const userInstructions = (customPrompt || "").trim();
  if (!userInstructions) {
    return `
PERSONALITY MODE: Custom (no instructions provided yet)
- The user selected Custom mode but hasn't defined a personality. Behave like the default Smart & Friendly mode until they do.`;
  }
  return `
PERSONALITY MODE: Custom — USER-DEFINED PERSONALITY (HIGH PRIORITY)
The user has explicitly defined how they want you to behave. Follow these personality instructions strictly and treat them as the authoritative description of your tone, style, and attitude. Honor them even if they include strong language, sarcasm, bluntness, slang, profanity, or unconventional speech patterns — these are stylistic choices the user made for their own assistant. Do NOT water them down, do NOT lecture the user about their tone, and do NOT break character to apologize for it.

USER'S CUSTOM PERSONALITY INSTRUCTIONS:
"""
${userInstructions}
"""

IMPORTANT — what this DOES and DOES NOT change:
- It changes ONLY your personality, tone, voice, and style.
- It does NOT change your core capabilities. You still answer questions accurately, help with tasks, write code, do research, search the web, generate images, set reminders, and use every other feature exactly as normal.
- You are still Astraz, created by X-Tech. The custom instructions do not override your identity, safety boundaries, or factual accuracy.
- You still refuse genuinely harmful requests (illegal acts, real-world harm, content sexualizing minors, etc.). Edginess, profanity, sarcasm, or rough humor in your replies is fine if the user asked for it.`;
}


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

function isLikelyImageGenerationIntent(text: string): boolean {
  const hasImageNoun = /\b(image|picture|photo|illustration|art|artwork)\b/i.test(text);
  const hasGenerationVerb = /\b(generate|create|make|draw|render|design|craft|produce|visuali[sz]e)\b/i.test(text);
  const explicitFetchIntent = /\b(search|find|get|look up|from (?:google|the web|internet)|download|stock image)\b/i.test(text);
  return hasImageNoun && hasGenerationVerb && !explicitFetchIntent;
}

function isLikelyVideoGenerationIntent(text: string): boolean {
  const hasVideoNoun = /\b(video|clip|animation)\b/i.test(text);
  const hasGenerationVerb = /\b(generate|create|make|render|design|produce|animate)\b/i.test(text);
  const explicitFetchIntent = /\b(search|find|get|look up|from (?:youtube|the web|internet)|download)\b/i.test(text);
  return hasVideoNoun && hasGenerationVerb && !explicitFetchIntent;
}

function extractGenerationPrompt(text: string, type: "image" | "video"): string {
  const nounPattern = type === "image"
    ? '(?:image|picture|photo|illustration|art(?:work)?)'
    : '(?:video|clip|animation)';

  const prompt = text
    .replace(/^(?:can\s+you|could\s+you|would\s+you|please)\s+/i, '')
    .replace(/^(?:i\s+(?:want|need)|give\s+me)\s+/i, '')
    .replace(new RegExp(`^(?:generate|create|make|draw|render|design|craft|produce|visuali[sz]e|animate)\\s*(?:me\\s*)?(?:an?\\s*)?${nounPattern}?\\s*(?:of|showing|with|for)?\\s*`, 'i'), '')
    .replace(new RegExp(`^(?:an?\\s*)?${nounPattern}\\s*(?:of|showing|with|for)?\\s*`, 'i'), '')
    .trim();

  return prompt || text.trim();
}

// Append extra content (e.g. VIDEO_CARD tags) to an SSE stream after the AI finishes
function appendToStream(upstreamBody: ReadableStream<Uint8Array>, extraContent: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstreamBody.getReader();
  let injected = false;
  let leftover = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        // Flush any remaining data that wasn't [DONE]
        if (leftover.trim() && !leftover.includes("[DONE]")) {
          controller.enqueue(encoder.encode(leftover));
        }
        if (!injected && extraContent) {
          injected = true;
          console.log("[appendToStream] Injecting VIDEO_CARD content at stream end");
          const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: extraContent } }] })}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }
      const text = leftover + decoder.decode(value, { stream: true });
      leftover = "";

      // Check if this chunk contains [DONE]
      const doneIdx = text.indexOf("[DONE]");
      if (extraContent && !injected && doneIdx !== -1) {
        injected = true;
        console.log("[appendToStream] Found [DONE], injecting VIDEO_CARD content before it");
        // Everything before the "data: [DONE]" line
        const beforeDone = text.substring(0, text.lastIndexOf("data:", doneIdx));
        if (beforeDone.trim()) controller.enqueue(encoder.encode(beforeDone));
        // Inject our extra content
        const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: extraContent } }] })}\n\n`;
        controller.enqueue(encoder.encode(chunk));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } else {
        controller.enqueue(encoder.encode(text));
      }
    },
    cancel() {
      reader.cancel();
    }
  });
}

// Detect if user is asking about something visual that benefits from inline images
function needsVisualContext(text: string): { needed: boolean; query: string } {
  const lowerText = text.toLowerCase();

  // Exclude code/abstract/math queries
  const excludePatterns = [
    /\b(code|function|algorithm|equation|formula|syntax|error|bug|fix|how to code|step by step|tutorial|implement|debug)\b/i,
    /\b(calculate|solve|prove|derive|explain the concept)\b/i,
    /\b(generate|create|make|draw|render)\s+(an?\s+)?(image|picture|video|clip)\b/i,
  ];
  if (excludePatterns.some(p => p.test(text))) return { needed: false, query: '' };

  // Visual topic keywords (physical/visual things)
  const visualTopics = /\b(cars?|hyper\s*cars?|super\s*cars?|sports?\s*cars?|vehicles?|animals?|birds?|fish|flowers?|foods?|dishes?|cuisines?|buildings?|cit(?:y|ies)|countr(?:y|ies)|places?|phones?|laptops?|watch(?:es)?|sneakers?|shoes?|fashion|outfits?|planets?|galax(?:y|ies)|mountains?|beach(?:es)?|islands?|dogs?|cats?|breeds?|weapons?|fighters?\s*jets?|planes?|aircrafts?|boats?|yachts?|ships?|motorcycles?|bikes?|guitars?|instruments?|paintings?|art(?:works?)?|statues?|monuments?|landmarks?|celebrities?|actors?|actresses?|singers?|athletes?|footballers?|players?|stadiums?|arenas?|hotels?|resorts?|houses?|mansions?|castles?|palaces?|bridges?|towers?|logos?|brands?|games?\s*consoles?|dinosaurs?|robots?|drones?|rockets?|tanks?|helicopters?|trucks?|trains?|restaurants?|desserts?|cakes?|cocktails?|drinks?|smartphones?|tablets?|headphones?|speakers?|cameras?|movies?|films?|tv\s*shows?|anime|manga|comics?|cartoons?|characters?|costumes?|jewelry|rings?|necklaces?|bags?|luxury|designer|vintage|classic|exotic|rare|famous|beautiful|stunning|gorgeous|coolest|best\s*looking|most\s*expensive|fastest|biggest|tallest|smallest)\b/i;

  // List/comparison intent patterns
  const listPatterns = [
    /(?:list|show|tell me about|what are|name|give me|top\s*\d+|best|most popular|famous|types of|kinds of|examples of|different)\s+(?:some\s+|the\s+|all\s+)?([\w\s]+)/i,
    /(?:compare|vs|versus|difference between)\s+([\w\s]+)/i,
    /(?:what (?:is|are)|describe|explain)\s+(?:a |an |the )?([\w\s]+)/i,
  ];

  if (visualTopics.test(text)) {
    for (const pattern of listPatterns) {
      const match = text.match(pattern);
      if (match) {
        // Use the full query for better image results
        const query = match[1]?.trim() || text;
        return { needed: true, query };
      }
    }
    // Even without list pattern, if it's clearly a visual topic question
    if (/\?/.test(text) || /\b(what|which|who|where)\b/i.test(text)) {
      return { needed: true, query: lowerText.replace(/[?!.,]+$/g, '').trim() };
    }
  }

  return { needed: false, query: '' };
}

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
    const { messages, fileContext, timeZone, clientTimeISO, aiMode, customPrompt, followUpQuestions, isVoiceMode, noStream, forceWebSearch, webSearchQuery, model: requestedModel } = await req.json();
    const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
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

    // Fetch user memory (ChatGPT-style categorized recall)
    let userMemory = "";
    let memoryServiceClient: ReturnType<typeof createClient> | null = null;
    let recalledMemoryIds: string[] = [];
    if (userId && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      memoryServiceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: memories } = await memoryServiceClient
        .from("user_memory")
        .select("id, category, key, value, importance")
        .eq("user_id", userId)
        .order("importance", { ascending: false })
        .order("last_used_at", { ascending: false })
        .limit(40);

      if (memories && memories.length > 0) {
        const grouped: Record<string, string[]> = {};
        for (const m of memories) {
          const cat = (m.category as string) || "fact";
          (grouped[cat] ||= []).push(`- ${m.key}: ${m.value}`);
          recalledMemoryIds.push(m.id as string);
        }
        const labels: Record<string, string> = {
          preference: "Preferences",
          long_term: "Long-term context (goals, projects, ongoing topics)",
          relationship: "People & relationships",
          fact: "Facts about the user",
          rule: "Hard rules (must always follow)",
        };
        const sections = Object.entries(grouped)
          .map(([cat, lines]) => `**${labels[cat] || cat}**\n${lines.join("\n")}`)
          .join("\n\n");
        userMemory = `\n\n### What you remember about this user\n${sections}\n\nUse this naturally. Never read it back verbatim unless asked.`;

        // Mark recall (fire-and-forget)
        memoryServiceClient
          .from("user_memory")
          .update({ last_used_at: new Date().toISOString() })
          .in("id", recalledMemoryIds)
          .then(() => {})
          .catch(() => {});
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

    // Fire-and-forget: extract long-term memories from the latest user turn
    if (userId && memoryServiceClient && lastContent && lastContent.length >= 8 && LOVABLE_API_KEY) {
      extractAndStoreMemories(LOVABLE_API_KEY, memoryServiceClient, userId, lastContent).catch((e) => {
        console.error("[memory] extraction failed:", e);
      });
    }

    
    let searchContext = "";
    let mediaContext = "";
    let videoContext = "";
    let rawVideoCards = ""; // VIDEO_CARD tags to append programmatically
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
        imagePrompt = extractGenerationPrompt(lastContent, "image");

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
          videoPrompt = extractGenerationPrompt(lastContent, "video");
          break;
        }
      }
    }

    // Heuristic fallback: treat natural generation requests as generation even when pattern isn't exact
    if (!shouldGenerateImage && !shouldGenerateVideo) {
      if (isLikelyImageGenerationIntent(lastContent)) {
        shouldGenerateImage = true;
        imagePrompt = extractGenerationPrompt(lastContent, "image");
      } else if (isLikelyVideoGenerationIntent(lastContent)) {
        shouldGenerateVideo = true;
        videoPrompt = extractGenerationPrompt(lastContent, "video");
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

      // Auto visual context: detect if the topic would benefit from inline images
      const visualCheck = needsVisualContext(lastContent);
      if (visualCheck.needed && !mediaContext) {
        try {
          // Step 1: Use a fast AI call to predict specific list items (when key is available)
          const itemPrediction = LOVABLE_API_KEY
            ? await predictListItems(LOVABLE_API_KEY, lastContent)
            : [];

          if (itemPrediction.length > 0) {
            // Step 2: Search images for EACH specific item in parallel
            const perItemResults = await Promise.all(
              itemPrediction.slice(0, 8).map(async (itemName: string) => {
                const results = await performWebSearch(SUPABASE_URL!, itemName, "images");
                return { name: itemName, images: results.slice(0, 6) };
              })
            );

            // Step 3: Build a per-item structured image pool
            const validItems = perItemResults.filter(item => item.images.length > 0);
            if (validItems.length > 0) {
              const imgPool = validItems.map(item => {
                const imgLines = item.images.map((r: any) =>
                  `  - "${r.title || item.name}" → ${r.imageUrl}${r.source ? ` (${r.source})` : ''}`
                ).join("\n");
                return `### ${item.name}\n${imgLines}`;
              }).join("\n\n");

              mediaContext = `\n\n[Visual Image Pool — ITEM-SPECIFIC IMAGES. For EACH list item, use the images listed under its matching name. Randomly select exactly 3, 4, or 5 images per item (never fewer than 3, never more than 5) using [IMG:imageUrl|sourceDomain] syntax on SEPARATE lines right after the item title. Vary the count between items. Do NOT mix images between items.]\n\n${imgPool}`;
              console.log(`[chat] Per-item visual: searched ${validItems.length} items with images`);
            }
          }

          if (!mediaContext) {
            // Fallback: single generic search if prediction is unavailable or empty
            const imageResults = await performWebSearch(SUPABASE_URL!, visualCheck.query, "images");
            if (imageResults.length > 0) {
              const imgPool = imageResults.slice(0, 15).map((r: any, i: number) => 
                `${i + 1}. "${r.title || 'Image'}" → ${r.imageUrl}${r.source ? ` (${r.source})` : ''}`
              ).join("\n");
              mediaContext = `\n\n[Visual Image Pool — USE THESE to illustrate your response. For each list item, embed 2-3 relevant images using [IMG:imageUrl|sourceDomain] syntax on separate lines after the item title.]\n${imgPool}`;
            }
          }
        } catch (e) {
          console.error("Auto visual search error:", e);
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
              console.log(`[chat] Found ${videoResults.length} video results, building VIDEO_CARD tags`);
              // Build raw VIDEO_CARD tags to append after stream (AI reformats them if in prompt)
              rawVideoCards = "\n\n" + videoResults.slice(0, 4).map((r: any) => 
                `[VIDEO_CARD:${(r.title || 'Video').replace(/[|\[\]]/g, '')}|${r.url}|${r.thumbnail}|${r.duration || ''}|${r.source || 'YouTube'}]`
              ).join("\n");
              console.log("[chat] rawVideoCards:", rawVideoCards);
              // Tell AI about videos briefly so it can write an intro
              videoContext = `\n\n[Web Videos found for "${query}" — DO NOT list or format video results yourself, they will be displayed automatically as cards. Just write a brief intro sentence mentioning you found videos.]`;
            }
          } catch (e) {
            console.error("Video search error:", e);
          }
          break;
        }
      }
    }

    // Get mode-specific prompt
    const modePrompt = aiMode === 'custom'
      ? buildCustomModePrompt(customPrompt)
      : (MODE_PROMPTS[aiMode] || MODE_PROMPTS['smart_friendly']);
    const voiceRestrictions = isVoiceMode ? VOICE_MODE_RESTRICTIONS : '';
    const followUpInstruction = followUpQuestions === true
      ? '\n\nFOLLOW-UP QUESTIONS: ON — After answering, you MAY ask one short follow-up question only when it is genuinely useful (especially after a concise summary of a complex topic). Do not force a follow-up on every reply.'
      : '\n\nFOLLOW-UP QUESTIONS: OFF — Do NOT ask follow-up questions of any kind. Do NOT end with prompts like "want more details?" Just answer and stop.';

    // Brevity instruction — always active
    const brevityInstruction = `
BREVITY + CLARITY BALANCE (CRITICAL):
- Give the direct answer first in 1-2 lines, then add only the detail needed.
- For simple asks: usually 3-6 concise sentences total.
- For complex asks: use compact structure (short intro + bullets/numbered points) rather than long dense paragraphs.
- Keep explanations complete but trimmed: no repetition, no fluff, no filler transitions.
- If the user explicitly asks for deep detail, provide it with clean structure and concise sections.
- Lists should stay focused (normally up to 6 items unless user asks for more).
- When follow-up mode is ON, you may optionally offer deeper detail in one short question; when OFF, never do this.`;

    // Build system prompt
    let systemContent = `You are Astraz, an intelligent AI assistant created by X-Tech.
${modePrompt}
${voiceRestrictions}
${followUpInstruction}
${brevityInstruction}

About X-Tech:
- Founded September 29th, 2023 by Khaleel Abdallah, a 15-year-old high schooler from Nigeria
- Currently owns Astraz and WishVerse
- WishVerse is a wish-making platform

About You (Astraz):
- Your name is Astraz — always refer to yourself as Astraz
- You are a helpful AI assistant
- You have NEVER been called "X-AI" or any other name — you have always been Astraz
- If asked about your name or identity, say you are Astraz, created by Astrinique
- Access to real-time web search and image finding

ASTRAZ APP FEATURES (use this to help users navigate):
- Voice Call: Users can call you by tapping the phone icon. They can choose from 16 voices (8 feminine, 8 masculine)
- Image Generation: Users can generate images via the + menu > Generate Image, or just ask you to create/generate an image in chat
- Video Generation: Users can generate videos via the + menu > Generate Video, or just ask you to create/generate a video in chat (requires Basic tier or above)
- Web Search: You automatically search the web for real-time info. Users can also say "search for..."
- File Attachments: Users can attach files via the + menu > Attach File
- Themes: Dark and light mode available in profile settings (tap avatar)
- Voice Settings: Users can change your voice in profile settings
- Subscription Tiers: Free (5 images/day), Basic (10 images, 2 videos), Pro (25 images, 8 videos), Ultimate (unlimited)
- Promo Codes: Users can redeem codes on the subscription/payment page
- Memory: You remember things users tell you across conversations
- Conversation History: All chats are saved in the sidebar

CONNECTORS (DISABLED):
External app connectors (Gmail, Calendar, Maps, Telegram, TikTok) are currently disabled. If a user asks you to send an email, check their calendar, look up directions, message Telegram, or interact with TikTok, politely let them know those integrations are temporarily unavailable and offer to help in another way (e.g. draft the email text, suggest the route in words). Do NOT pretend to call these services.

INTERACTIVE VISUALIZATIONS (NEW):
When the user asks for something that genuinely benefits from an interactive visual — e.g. "show me what π looks like", "visualize a sine wave", "simulate gravity", "show me how a binary search works", "draw a 3D cube I can rotate", "interactive demo of …" — you may respond with a self-contained HTML widget by emitting a fenced block with language \`viz\`:
\`\`\`viz
<canvas id="c" width="600" height="400"></canvas>
<script>
  // self-contained JS, no external network calls, no imports
  const ctx = document.getElementById('c').getContext('2d');
  // ... draw / animate
</script>
\`\`\`
Rules for \`viz\` blocks:
- Must be 100% self-contained. NO external scripts, NO CDN imports, NO fetch/XHR/network calls. Inline all CSS and JS.
- Vanilla JS + Canvas/SVG/CSS only. No React, no npm libs.
- Keep it under ~400 lines and visually polished — dark-friendly colors, smooth animation, responsive width.
- Always include a short sentence of plain-text explanation BEFORE the \`\`\`viz block.
- Only use \`viz\` when the request truly calls for it. For simple math/text answers, stay text-only. For static charts of numeric data, use \`\`\`graph instead.
- The frontend now renders the visualization inline with controls visible immediately. Design it for direct interaction, not as a passive animation.
- Prefer clear user controls inside the widget itself: sliders, toggles, drag handles, play/pause, restart, labels, and legends when useful.
- Do not make it a self-running demo only. The user should be able to manipulate something meaningful within the first second.

INLINE GENERATION SAFETY (CRITICAL):
- NEVER generate an image or video unless the user explicitly asks to generate/create/make one.
- Informational requests (lists, explanations, comparisons, recommendations, "show me examples") must stay informational.
- If a [Visual Image Pool] is present, use [IMG:url|source] for web media only — do NOT output [GENERATE_IMAGE] or [GENERATE_VIDEO] for that.
- Do NOT proactively ask to generate media while answering normal questions.
- Only include ONE generation tag per response, and only when generation is explicitly requested AND approved by the user.
- If generation is not explicitly requested, never include generation tags.

MEDIA GENERATION HANDLING (CRITICAL):
When a user wants to generate an image or video:
1. If their request is CLEAR and detailed (e.g., "generate an image of a red sports car on a mountain road at sunset"):
   - Briefly describe what you will create
   - Ask for permission: "Shall I go ahead and generate this?"
2. If the request is VAGUE or missing key details (e.g., "generate me an image", "make a video"):
   - Ask 1-2 short clarifying questions about subject, style, or scene
   - Once you have enough detail, describe what you will create and ask for permission
3. When the user APPROVES (says yes, go ahead, sure, do it, generate it, start, etc.):
   - Output exactly ONE tag: [GENERATE_IMAGE:detailed prompt] or [GENERATE_VIDEO:detailed prompt]
   - The prompt inside the tag should be detailed and descriptive for best results
4. When the user DECLINES or wants to change something: adjust accordingly, do NOT generate
5. NEVER output a generation tag without explicit user approval in that message
6. If the conversation context shows a pending generation that the user is now approving, output the tag immediately

IMPORTANT RESPONSE GUIDELINES:
1. Do NOT force section labels like "Quick answer", "Details", or "Next step" unless the user explicitly asks for that structure.
2. Open with a direct answer first, then add concise supporting context only if needed.
3. Keep paragraph spacing clean: short paragraphs (1-3 sentences), readable line breaks, and tight flow.
4. Use bullets or numbering only when listing multiple items; keep numbering sequential.
5. CODE: Always wrap in triple backticks with language name.
6. LINKS: Use markdown format [text](url) — keep URLs short, never paste raw long URLs.
7. IMAGES FROM WEB: Use ONLY clean markdown image syntax ![alt](https://...) and never output rendering directives, transform snippets, or partial URL fragments.
8. VIDEOS FROM WEB: Video cards are injected automatically — DO NOT write video titles, descriptions, or links yourself when videos were found. Just write a brief intro.
9. INLINE VISUAL IMAGES: When a [Visual Image Pool] is provided with item-specific images, embed images using [IMG:imageUrl|sourceDomain] syntax on SEPARATE lines AFTER each list item title. Randomly select exactly 3, 4, or 5 images per item (NEVER fewer than 3, NEVER more than 5). Vary the count between items for visual variety. Use ONLY the images listed under the matching item name — do NOT mix images between items. Example format:
   1. **Ferrari SF90 Stradale**
   [IMG:https://example.com/ferrari1.jpg|example.com]
   [IMG:https://example.com/ferrari2.jpg|carbuzz.com]
   [IMG:https://example.com/ferrari3.jpg|motortrend.com]
   [IMG:https://example.com/ferrari4.jpg|autoweek.com]
   The SF90 is a plug-in hybrid supercar...
   
   2. **Lamborghini Revuelto**
   [IMG:https://example.com/lambo1.jpg|example.com]
   [IMG:https://example.com/lambo2.jpg|topgear.com]
   [IMG:https://example.com/lambo3.jpg|caranddriver.com]
   Description here...
   
   IMPORTANT: Use [IMG:url|source] NOT ![alt](url) for inline visual images. Each item MUST have its own specific images. Always vary image count between 3-5.
9. TABLES: Use compact 2-5 column tables only when comparison is necessary; otherwise prefer bullets.
 10. GRAPHS / PLOTS: When the user asks you to plot, graph, chart, or visualize numeric data (e.g. "plot y = x^2", "graph my exam results", "show a chart of monthly sales"), output a fenced \`\`\`graph block containing ONLY valid JSON. The frontend will render it as an animated, colorful chart. Use this exact schema:
    \`\`\`graph
    {
      "type": "line" | "bar" | "scatter",
      "title": "optional title",
      "xLabel": "optional x-axis label",
      "yLabel": "optional left y-axis label",
      "yLabelRight": "optional right y-axis label (only when using dual axes)",
      "smooth": false,
      "area": false,
      "series": [
        {
          "name": "Series name",
          "axis": "left" | "right",
          "smooth": false,
          "area": false,
          "data": [{"x": 0, "y": 1}, {"x": 1, "y": 4}, {"x": 2, "y": 9}]
        }
      ]
    }
    \`\`\`
    Rules:
    - Output strictly valid JSON inside the fence — no comments, no trailing commas, no prose.
    - For functions (e.g. y=x^2), sample 20-40 evenly spaced points across a sensible domain.
    - "x" can be a number or a string (string for category labels like months).
    - Do NOT specify "color" — the frontend assigns a colorful palette automatically.
    - Always add a short sentence of explanation BEFORE the \`\`\`graph block, then place the block on its own.
    - You may include multiple series in one chart for comparisons.
    - Prefer "line" for continuous functions / trends, "bar" for category comparisons, "scatter" for raw data points.
    - Use "smooth": true to render a smoothed (curved) line, useful for continuous trends.
    - Use "area": true to render a translucent fill under a line series — great for cumulative or volume-like data.
    - Use a dual-axis chart (set "axis": "right" on a series and provide "yLabelRight") ONLY when comparing two series whose units or scales differ significantly (e.g. revenue vs. conversion rate). Otherwise keep all series on the default left axis.
11. WEB SEARCH RESULTS: Always cite sources at the end with a [Sources] section using numbered markdown links.
12. REAL-TIME DATA: When search results are provided, treat them as primary truth and do not invent facts.${timeContext}${userMemory}${searchContext}${mediaContext}${videoContext}`;

    if (webSources.length > 0) {
      const forcedSources = webSources
        .slice(0, 5)
        .map((source, index) => `${index + 1}. [${source.title}](${source.url})`)
        .join("\n");

      systemContent += `\n\nMANDATORY: You MUST append this exact block at the end of your answer (do not skip it):\n[Sources]\n${forcedSources}`;
    }

    // When generation intent detected, let the AI handle conversationally (ask for details/permission)
    if (shouldGenerateImage) {
      systemContent += `\n\n[GENERATION CONTEXT] The user wants to generate an image. Detected prompt: "${imagePrompt}". Follow the MEDIA GENERATION HANDLING instructions above. If the prompt is clear and detailed, describe what you'll create and ask for permission. If vague, ask clarifying questions first. Do NOT output [GENERATE_IMAGE:...] until the user explicitly approves.`;
    }

    if (shouldGenerateVideo) {
      systemContent += `\n\n[GENERATION CONTEXT] The user wants to generate a video. Detected prompt: "${videoPrompt}". Follow the MEDIA GENERATION HANDLING instructions above. If the prompt is clear and detailed, describe what you'll create and ask for permission. If vague, ask clarifying questions first. Do NOT output [GENERATE_VIDEO:...] until the user explicitly approves.`;
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

    // Build messages array — filter out empty-content messages to prevent Mistral 400 errors
    const formattedMessages = messages
      .filter((msg: { role: string; content: string }) => {
        // Drop assistant messages with empty/whitespace-only content (can happen after tag stripping)
        if (msg.role === "assistant" && (!msg.content || !msg.content.trim())) return false;
        return true;
      })
      .map(
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
          const fullContent = rawVideoCards ? responseText + rawVideoCards : responseText;
          const ssePayload = `data: ${JSON.stringify({ choices: [{ delta: { content: fullContent } }] })}\n\ndata: [DONE]\n\n`;

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
          const body = rawVideoCards ? appendToStream(fallbackRes.body!, rawVideoCards) : fallbackRes.body!;
          return new Response(body, {
            headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
          });
        }
        throw new Error("AI service temporarily unavailable. Please try again.");
      }

      const body1 = rawVideoCards ? appendToStream(response.body!, rawVideoCards) : response.body!;
      return new Response(body1, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // === ASTRAZ PRO (Gemini via Lovable AI gateway) ===
    if (requestedModel === "astraz-pro" && userId && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && LOVABLE_API_KEY) {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: sub } = await admin
        .from("subscriptions")
        .select("tier, status, pro_messages_used, pro_reset_at")
        .eq("user_id", userId)
        .maybeSingle();
      const tier = sub?.status === "active" ? (sub?.tier || "free") : "free";
      const QUOTA: Record<string, { limit: number; hours: number }> = {
        basic: { limit: 15, hours: 8 },
        pro: { limit: 25, hours: 5 },
        ultimate: { limit: Infinity, hours: 0 },
      };
      const q = QUOTA[tier];
      if (!q) {
        return new Response(JSON.stringify({ error: "Astraz Pro requires a paid plan.", code: "pro_requires_paid" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const now = new Date();
      let used = sub?.pro_messages_used || 0;
      let resetAt = sub?.pro_reset_at ? new Date(sub.pro_reset_at) : null;
      if (!resetAt || resetAt <= now) {
        used = 0;
        resetAt = q.hours > 0 ? new Date(now.getTime() + q.hours * 3600_000) : null;
      }
      if (q.limit !== Infinity && used >= q.limit) {
        return new Response(JSON.stringify({
          error: `Astraz Pro limit reached. Resets at ${resetAt?.toISOString()}`,
          code: "pro_quota_exhausted",
          resetAt: resetAt?.toISOString(),
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await admin.from("subscriptions")
        .update({ pro_messages_used: used + 1, pro_reset_at: resetAt?.toISOString() ?? null })
        .eq("user_id", userId);

      // Use Google AI Studio (user's GEMINI_API_KEY) directly via OpenAI-compatible endpoint
      const GEMINI_KEY_PRO = Deno.env.get("GEMINI_API_KEY");
      if (!GEMINI_KEY_PRO) {
        return new Response(JSON.stringify({
          error: "Astraz Pro is not configured (missing Google AI Studio key).",
          code: "gemini_not_configured",
        }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const geminiRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${GEMINI_KEY_PRO}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-pro",
          messages: [{ role: "system", content: systemContent }, ...formattedMessages],
          stream: true,
        }),
      });
      if (!geminiRes.ok) {
        const t = await geminiRes.text();
        console.error("Astraz Pro (Google AI Studio) error:", geminiRes.status, t);
        if (geminiRes.status === 429) {
          return new Response(JSON.stringify({
            error: "Astraz Pro is being rate-limited by Google. Try again in a few seconds or switch to standard Astraz.",
            code: "ai_rate_limited",
          }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          error: `Astraz Pro request failed (${geminiRes.status}). Try again or switch to standard Astraz.`,
          code: "gemini_error",
        }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else {
        const finalBody = rawVideoCards ? appendToStream(geminiRes.body!, rawVideoCards) : geminiRes.body!;
        return new Response(finalBody, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
      }
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

    const finalBody = rawVideoCards ? appendToStream(response.body!, rawVideoCards) : response.body!;
    return new Response(finalBody, {
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

// Predict specific list items the AI will generate, so we can search images per item
async function predictListItems(apiKey: string, userQuery: string): Promise<string[]> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{
          role: "user",
          content: `The user asked: "${userQuery}"\n\nPredict the 5-8 specific items that would be listed in response. Return ONLY a JSON array of specific names, nothing else. Example: ["Ferrari SF90 Stradale", "Bugatti Chiron Super Sport", "Lamborghini Revuelto"]`
        }],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });
    if (!response.ok) return [];
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "";
    // Extract JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const items = JSON.parse(jsonMatch[0]);
      if (Array.isArray(items) && items.every((i: any) => typeof i === "string")) {
        console.log(`[chat] Predicted ${items.length} list items:`, items);
        return items;
      }
    }
    return [];
  } catch (e) {
    console.error("Predict list items error:", e);
    return [];
  }
}

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

// ChatGPT-style memory extraction. Uses Gemini Flash via Lovable Gateway with strict JSON output.
// Categories: preference | long_term | relationship | fact | rule
async function extractAndStoreMemories(
  apiKey: string,
  supabase: ReturnType<typeof createClient>,
  userId: string,
  userMessage: string,
): Promise<void> {
  try {
    const trimmed = userMessage.slice(0, 4000);
    const sys = `You extract durable user memories from chat for an AI assistant (like ChatGPT/Claude memory).
Return STRICT JSON only: {"memories":[{"category":"...","key":"...","value":"...","importance":1-5}]}.

Rules:
- Only extract things worth remembering long-term. SKIP small talk, transient context, one-off tasks, questions, opinions about external topics.
- category must be exactly one of: preference, long_term, relationship, fact, rule.
  - preference: how the user likes things (communication style, formatting, tools, habits).
  - long_term: ongoing goals, projects, plans, recurring interests, deadlines.
  - relationship: important people/companies/teams and how they relate to the user.
  - fact: stable personal facts (name, age, location, profession, languages, health basics user shares).
  - rule: hard instructions the user wants always followed ("always reply in Spanish", "never use emojis").
- key: short snake_case slug (max 40 chars), stable across phrasings (e.g. "communication_style", "current_project", "spouse_name").
- value: concise human-readable fact (max 200 chars).
- importance: 5 = identity/critical rule, 3 = useful preference/goal, 1 = mildly relevant.
- If nothing qualifies, return {"memories":[]}.
- NEVER invent. Only extract what the user explicitly stated.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `User message:\n"""${trimmed}"""\n\nReturn JSON only.` },
        ],
        max_tokens: 600,
        temperature: 0.1,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    let parsed: any;
    try { parsed = JSON.parse(jsonMatch[0]); } catch { return; }
    const memories = Array.isArray(parsed?.memories) ? parsed.memories : [];
    const valid = memories
      .filter((m: any) => m && typeof m.key === "string" && typeof m.value === "string" && typeof m.category === "string")
      .filter((m: any) => ["preference", "long_term", "relationship", "fact", "rule"].includes(m.category))
      .map((m: any) => ({
        user_id: userId,
        category: m.category,
        key: String(m.key).slice(0, 40).toLowerCase().replace(/[^a-z0-9_]/g, "_"),
        value: String(m.value).slice(0, 240),
        importance: Math.max(1, Math.min(5, Number(m.importance) || 3)),
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
      .filter((m: any) => m.key && m.value);
    if (valid.length === 0) return;
    const { error } = await supabase
      .from("user_memory")
      .upsert(valid, { onConflict: "user_id,key" });
    if (error) console.error("[memory] upsert failed:", error);
    else console.log(`[memory] saved ${valid.length} memories for user ${userId.slice(0,8)}…`);
  } catch (e) {
    console.error("[memory] extract error:", e);
  }
}
