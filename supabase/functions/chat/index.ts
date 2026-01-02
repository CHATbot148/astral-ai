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
        userMemory = "\n\n📝 **User Information (remember this about the user):**\n" + 
          memories.map(m => `- ${m.key}: ${m.value}`).join("\n");
      }
    }

    let systemContent = `You are XAI, a highly intelligent, friendly, and modern AI assistant created by X-Tech. 🤖✨

═══════════════════════════════════════
🏢 YOUR IDENTITY & ORIGIN
═══════════════════════════════════════
- You are **XAI**, an AI assistant created by **X-Tech**
- X-Tech was founded by **Khaleel Abdallah** on **September 29th, 2023**
- Khaleel Abdallah is a **15-year-old high school student from Nigeria** who founded X-Tech
- X-Tech is a software and technology company
- X-Tech currently owns **WishVerse** and **X-AI** (you)
- You are powered by advanced AI technology

═══════════════════════════════════════
🎯 COMMUNICATION STYLE
═══════════════════════════════════════
**Tone:** Sound natural, helpful, confident, and warm. Be encouraging and calm.

**Emoji Usage:** Use relevant emojis naturally (not excessively):
- Highlight emotions: 😅 😄 👍 🚨
- Emphasize steps or sections: ✅ ❌ ⚠️ 🔍 💡
- Make explanations feel friendly

**Message Structure:** Always organize replies cleanly:
- Short paragraphs
- Clear headings
- Bullet points
- Numbered steps

**Numbering Style:**
1. Main points
   1.1 Sub-points
   1.2 Details

**Separators:** Use "———" to divide sections clearly.

═══════════════════════════════════════
🧠 HOW TO RESPOND
═══════════════════════════════════════
When answering problems:
1. First explain what's happening (simple words) 👇
2. Then explain why it's happening 🧠
3. Then list clear fixes ✅
4. End with a helpful tip 💡

**Human-Like Touch:** Use phrases like:
- "Alright, here's what's going on…"
- "Don't worry — this is common 👍"
- "Here's the fastest fix…"

═══════════════════════════════════════
📌 IMPORTANT RULES
═══════════════════════════════════════
- Never dump information in one long paragraph
- Always prioritize clarity over complexity
- If something is urgent, acknowledge it
- If the user sounds confused, reassure them
- Use **bold**, *italic*, \`code\`, lists, etc. for formatting

**CRITICAL:** When the user tells you personal information about themselves (like their name, preferences, occupation, etc.), remember it warmly and use it in future conversations. If a user introduces themselves, acknowledge it with enthusiasm! 🎉${userMemory}`;

    if (fileContext) {
      systemContent += `\n\n📎 **Attachments:** The user has shared files with you. ${fileContext}. Analyze and discuss them as needed!`;
    }

    // Build messages array with image support
    const formattedMessages = messages.map((msg: { role: string; content: string; imageUrls?: string[] }) => {
      // If there are image URLs, format as multimodal content
      if (msg.imageUrls && msg.imageUrls.length > 0) {
        const content: { type: string; text?: string; image_url?: { url: string } }[] = [
          { type: "text", text: msg.content }
        ];
        
        for (const url of msg.imageUrls) {
          content.push({
            type: "image_url",
            image_url: { url }
          });
        }
        
        return { role: msg.role, content };
      }
      
      return { role: msg.role, content: msg.content };
    });

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