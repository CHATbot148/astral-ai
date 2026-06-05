// Supabase Edge Function: WebSocket proxy between browser and Gemini Live API.
// Browser cannot send custom headers on WebSocket, so JWT is passed via ?token=.
// verify_jwt is set to false in config.toml — we validate manually.
import { GoogleGenAI, Modality, type LiveServerMessage } from "npm:@google/genai@2.8.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

Deno.serve(async (req) => {
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }
  if (!GEMINI_API_KEY) {
    return new Response("GEMINI_API_KEY not configured", { status: 500 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 401 });

  // Validate JWT via service-role client
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userData?.user) return new Response("Invalid token", { status: 401 });

  const { socket, response } = Deno.upgradeWebSocket(req);
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  let session: any = null;

  socket.onopen = () => {
    console.log("[gemini-live-proxy] client connected user=", userData.user.id);
  };

  socket.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === "setup") {
        try {
          session = await ai.live.connect({
            model: "models/gemini-2.0-flash-exp",
            callbacks: {
              onmessage: (m: LiveServerMessage) => {
                if (socket.readyState === WebSocket.OPEN) {
                  socket.send(JSON.stringify(m));
                }
              },
              onclose: () => {
                if (socket.readyState === WebSocket.OPEN) {
                  socket.send(JSON.stringify({ type: "error", message: "Gemini connection closed" }));
                  socket.close();
                }
              },
              onerror: (err: any) => {
                const errMsg = err?.message || "Gemini session error";
                console.error("[gemini-live-proxy] session error:", errMsg);
                if (socket.readyState === WebSocket.OPEN) {
                  socket.send(JSON.stringify({ type: "error", message: errMsg }));
                }
              },
            },
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: msg.voiceName || "Puck" } },
              },
              systemInstruction: msg.systemInstruction || "You are Astraz, a helpful AI voice assistant.",
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          });
          socket.send(JSON.stringify({ type: "connected" }));
        } catch (err: any) {
          console.error("[gemini-live-proxy] connect failed:", err);
          socket.send(JSON.stringify({ type: "error", message: "Failed to connect to Gemini: " + (err?.message || err) }));
          socket.close();
        }
        return;
      }

      if (session && msg.audio) {
        session.sendRealtimeInput({
          audio: { mimeType: "audio/pcm;rate=24000", data: msg.audio },
        });
      }
    } catch (err) {
      console.error("[gemini-live-proxy] msg error:", err);
    }
  };

  socket.onclose = () => {
    console.log("[gemini-live-proxy] client disconnected");
    try { session?.close?.(); } catch {}
  };

  socket.onerror = (err) => console.error("[gemini-live-proxy] ws err:", err);

  return response;
});
