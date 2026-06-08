// Supabase Edge Function: WebSocket proxy between browser and Gemini Live API.
// Uses Deno-native WebSocket (no SDK) for reliability inside the edge runtime.
// Browser cannot send custom headers on WebSocket, so JWT is passed via ?token=.
// verify_jwt is false in config.toml — we validate manually.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

// Stable Gemini Live models in priority order (best audio first, then fallbacks).
const MODELS = [
  "models/gemini-3.1-flash-live-preview",
  "models/gemini-2.5-flash-native-audio-latest",
  "models/gemini-2.0-flash-live-001",
];

function geminiWsUrl(model: string) {
  // BidiGenerateContent live endpoint
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
}

async function tryGeminiConnect(model: string, systemInstruction: string, voiceName: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let opened = false;
    const upstream = new WebSocket(geminiWsUrl(model));
    const timeout = setTimeout(() => {
      if (!opened) { try { upstream.close(); } catch {} reject(new Error("Gemini connect timeout")); }
    }, 8000);

    upstream.onopen = () => {
      opened = true;
      clearTimeout(timeout);
      upstream.send(JSON.stringify({
        setup: {
          model,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
          systemInstruction: { parts: [{ text: systemInstruction }] },
          realtimeInputConfig: {},
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      }));
      resolve(upstream);
    };
    upstream.onerror = (e) => {
      clearTimeout(timeout);
      if (!opened) reject(new Error(`Gemini WS error for ${model}`));
    };
    upstream.onclose = (e) => {
      clearTimeout(timeout);
      if (!opened) reject(new Error(`Gemini closed before open (${e.code}) for ${model}`));
    };
  });
}

Deno.serve(async (req) => {
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
  if (!GEMINI_API_KEY) return new Response("GEMINI_API_KEY not configured", { status: 500 });

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 401 });

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userData?.user) return new Response("Invalid token", { status: 401 });

  const { socket: client, response } = Deno.upgradeWebSocket(req);
  let upstream: WebSocket | null = null;
  let keepalive: number | null = null;
  let setupReceived = false;

  const safeSendClient = (obj: unknown) => {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(typeof obj === "string" ? obj : JSON.stringify(obj)); } catch {}
    }
  };

  client.onopen = () => {
    console.log("[gemini-live-proxy] client connected user=", userData.user.id);
    keepalive = setInterval(() => safeSendClient({ type: "ping" }), 15000) as unknown as number;
  };

  client.onmessage = async (event) => {
    try {
      const msg = JSON.parse(typeof event.data === "string" ? event.data : "{}");
      if (msg.type === "pong") return;

      if (msg.type === "setup" && !setupReceived) {
        setupReceived = true;
        let lastErr: any = null;
        for (const m of MODELS) {
          try {
            upstream = await tryGeminiConnect(m, msg.systemInstruction || "You are Astraz, a helpful AI voice assistant.", msg.voiceName || "Puck");
            console.log("[gemini-live-proxy] connected to", m);
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            console.warn("[gemini-live-proxy] model failed", m, (e as Error)?.message);
          }
        }
        if (!upstream) {
          safeSendClient({ type: "error", message: "Failed to connect to Gemini: " + (lastErr?.message || "all models failed") });
          try { client.close(); } catch {}
          return;
        }

        // Wire upstream → client
        upstream.onmessage = (ev) => {
          const handlePayload = (payload: string) => {
            try {
              const parsed = JSON.parse(payload);
              if (parsed.setupComplete) {
                safeSendClient({ type: "connected" });
                return;
              }
              if (parsed.error) {
                const errMessage = parsed.error.message || parsed.error.status || parsed.error.code || "Gemini setup failed";
                safeSendClient({ type: "error", message: String(errMessage) });
                return;
              }
              if (parsed.goAway) {
                const timeLeft = parsed.goAway.timeLeft ? ` (${parsed.goAway.timeLeft} left)` : "";
                safeSendClient({ type: "error", message: `Gemini asked to close the session${timeLeft}` });
                return;
              }
              safeSendClient(parsed);
            } catch {
              safeSendClient(payload);
            }
          };

          if (typeof ev.data === "string") handlePayload(ev.data);
          else if (ev.data instanceof ArrayBuffer) {
            // Convert to string (Gemini sends JSON over binary sometimes)
            try { handlePayload(new TextDecoder().decode(ev.data)); } catch {}
          } else if (ev.data instanceof Blob) {
            ev.data.text().then((t) => handlePayload(t)).catch(() => {});
          }
        };
        upstream.onerror = (e) => {
          console.error("[gemini-live-proxy] upstream error", e);
          safeSendClient({ type: "error", message: "Gemini session error while starting the live call." });
        };
        upstream.onclose = (event) => {
          console.log("[gemini-live-proxy] upstream closed", event.code, event.reason);
          const reason = event.reason?.trim();
          safeSendClient({
            type: "error",
            message: reason ? `Gemini connection closed: ${reason}` : `Gemini connection closed (code ${event.code || 1000})`,
          });
          try { client.close(); } catch {}
        };
        return;
      }

      if (upstream && upstream.readyState === WebSocket.OPEN && msg.audio) {
        upstream.send(JSON.stringify({
          realtimeInput: {
            audio: { mimeType: "audio/pcm;rate=16000", data: msg.audio },
          },
        }));
      }
    } catch (err) {
      console.error("[gemini-live-proxy] msg error:", err);
    }
  };

  client.onclose = () => {
    console.log("[gemini-live-proxy] client disconnected");
    if (keepalive) { clearInterval(keepalive); keepalive = null; }
    try { upstream?.close(); } catch {}
  };
  client.onerror = (err) => console.error("[gemini-live-proxy] client ws err:", err);

  return response;
});
