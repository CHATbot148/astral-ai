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
    const { agentId } = await req.json().catch(() => ({ agentId: undefined }));

    const ELEVENLABS_API_KEY2 = Deno.env.get("ELEVENLABS_API_KEY2");
    if (!ELEVENLABS_API_KEY2) {
      return new Response(JSON.stringify({ error: "ELEVENLABS_API_KEY2 is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!agentId || typeof agentId !== "string") {
      return new Response(JSON.stringify({ error: "agentId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`;

    const resp = await fetch(url, {
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY2,
      },
    });

    const text = await resp.text();
    if (!resp.ok) {
      console.error("ElevenLabs token error:", resp.status, text);
      return new Response(JSON.stringify({ error: "Failed to create conversation token" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = JSON.parse(text);
    if (!data?.token) {
      console.error("ElevenLabs token missing:", data);
      return new Response(JSON.stringify({ error: "Token missing from ElevenLabs" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ token: data.token }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("elevenlabs-conversation-token error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
