import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PhoneOff, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { VoiceOrb } from "./VoiceOrb";

interface VoiceCallProps {
  onClose: () => void;
}

const VOICE_OPTIONS = [
  { id: "asteria", name: "Asteria", gender: "feminine" },
  { id: "luna", name: "Luna", gender: "feminine" },
  { id: "athena", name: "Athena", gender: "feminine" },
  { id: "hera", name: "Hera", gender: "feminine" },
  { id: "stella", name: "Stella", gender: "feminine" },
  { id: "aurora", name: "Aurora", gender: "feminine" },
  { id: "thalia", name: "Thalia", gender: "feminine" },
  { id: "cordelia", name: "Cordelia", gender: "feminine" },
  { id: "orion", name: "Orion", gender: "masculine" },
  { id: "zeus", name: "Zeus", gender: "masculine" },
  { id: "helios", name: "Helios", gender: "masculine" },
  { id: "arcas", name: "Arcas", gender: "masculine" },
  { id: "perseus", name: "Perseus", gender: "masculine" },
  { id: "angus", name: "Angus", gender: "masculine" },
  { id: "orpheus", name: "Orpheus", gender: "masculine" },
  { id: "apollo", name: "Apollo", gender: "masculine" },
];

const SYSTEM = `You are a concise AI voice assistant called Astraz. Max 3 sentences per reply. No markdown, no lists. Speak naturally as in a phone call.`;
const SILENCE_TIMEOUT_MS = 1800;

type CallStatus = "idle" | "connecting" | "listening" | "speaking";

export const VoiceCall = ({ onClose }: VoiceCallProps) => {
  const { toast } = useToast();
  const [callStart] = useState(() => Date.now());
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(() =>
    localStorage.getItem("xai-tts-voice") || "asteria"
  );
  const [silenceCutoff, setSilenceCutoff] = useState<number>(() => {
    const saved = Number(localStorage.getItem("xai-voice-silence-cutoff-ms"));
    return Number.isFinite(saved) ? Math.min(5500, Math.max(800, saved)) : 2300;
  });
  const [status, setStatus] = useState<CallStatus>("idle");
  const [isConnected, setIsConnected] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  // Refs
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const historyRef = useRef<{ role: string; content: string }[]>([]);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechBufferRef = useRef("");
  const isActiveRef = useRef(false);
  const bargedInRef = useRef(false);
  const isMutedRef = useRef(isMuted);
  const selectedVoiceRef = useRef(selectedVoice);
  const silenceCutoffRef = useRef(silenceCutoff);
  const statusRef = useRef<CallStatus>("idle");

  // Mic level tracking
  const streamRef = useRef<MediaStream | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micAnimFrameRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => { selectedVoiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => {
    silenceCutoffRef.current = silenceCutoff;
    localStorage.setItem("xai-voice-silence-cutoff-ms", String(silenceCutoff));
  }, [silenceCutoff]);

  useEffect(() => {
    const t = setInterval(() => setCallDuration(Math.floor((Date.now() - callStart) / 1000)), 1000);
    return () => clearInterval(t);
  }, [callStart]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const stopSpeaking = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    utteranceRef.current = null;
    setAudioLevel(0);
  }, []);

  // Mic level tracking
  const startMicLevelTracking = useCallback(() => {
    if (!streamRef.current) return;
    try {
      const ctx = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(streamRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      micAnalyserRef.current = analyser;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const update = () => {
        if (!isActiveRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
        if (statusRef.current === "listening") {
          setAudioLevel(avg / 255);
        }
        micAnimFrameRef.current = requestAnimationFrame(update);
      };
      micAnimFrameRef.current = requestAnimationFrame(update);
    } catch {}
  }, []);

  const stopMicLevelTracking = useCallback(() => {
    if (micAnimFrameRef.current) {
      cancelAnimationFrame(micAnimFrameRef.current);
      micAnimFrameRef.current = 0;
    }
    setAudioLevel(0);
  }, []);

  // ── Stream response via edge function, speak each sentence via browser TTS ──
  const streamAndSpeak = useCallback(async (userText: string) => {
    if (!isActiveRef.current) return;

    historyRef.current.push({ role: "user", content: userText });
    setStatus("speaking");
    bargedInRef.current = false;
    stopMicLevelTracking();

    let fullReply = "";
    let sentenceBuffer = "";
    const sentenceEnd = /[.!?…]+[\s"')\]]*(?=\s|$)/;

    const speakChunk = (text: string): Promise<void> => {
      return new Promise((resolve) => {
        if (!isActiveRef.current || bargedInRef.current) { resolve(); return; }

        const synth = window.speechSynthesis;
        synthRef.current = synth;
        const utter = new SpeechSynthesisUtterance(text.trim());
        utteranceRef.current = utter;
        utter.rate = 1.08;
        utter.pitch = 1.0;

        const voices = synth.getVoices();
        const preferred = voices.find(v =>
          ["Samantha", "Google UK English Female", "Microsoft Aria", "Karen", "Moira"]
            .some(n => v.name.includes(n))
        );
        if (preferred) utter.voice = preferred;

        // Simulate audio level while speaking
        let speakInterval: ReturnType<typeof setInterval> | null = null;
        speakInterval = setInterval(() => {
          if (!synth.speaking || bargedInRef.current) {
            if (speakInterval) clearInterval(speakInterval);
            return;
          }
          setAudioLevel(0.3 + Math.random() * 0.5);
        }, 80);

        utter.onend = () => {
          if (speakInterval) clearInterval(speakInterval);
          setAudioLevel(0);
          resolve();
        };
        utter.onerror = () => {
          if (speakInterval) clearInterval(speakInterval);
          setAudioLevel(0);
          resolve();
        };

        synth.speak(utter);
      });
    };

    // Queue of chunks to speak sequentially
    const speakQueue: string[] = [];
    let isSpeakingQueue = false;

    const processSpeakQueue = async () => {
      if (isSpeakingQueue) return;
      isSpeakingQueue = true;
      while (speakQueue.length > 0 && isActiveRef.current && !bargedInRef.current) {
        const chunk = speakQueue.shift()!;
        await speakChunk(chunk);
      }
      isSpeakingQueue = false;
    };

    const queueChunk = (text: string) => {
      if (!text.trim() || bargedInRef.current) return;
      speakQueue.push(text);
      processSpeakQueue();
    };

    try {
      // Get auth headers
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const headers = {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      };

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: historyRef.current.map(({ role, content }) => ({ role, content })),
          isVoiceMode: true,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          clientTimeISO: new Date().toISOString(),
        }),
      });

      if (!res.ok) throw new Error(`API ${res.status}`);
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (bargedInRef.current || !isActiveRef.current) {
          reader.cancel();
          break;
        }

        sseBuffer += decoder.decode(value, { stream: true });

        let newlineIndex;
        while ((newlineIndex = sseBuffer.indexOf("\n")) !== -1) {
          let line = sseBuffer.slice(0, newlineIndex);
          sseBuffer = sseBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (!content) continue;

            fullReply += content;
            sentenceBuffer += content;

            const match = sentenceBuffer.match(sentenceEnd);
            if (match && match.index !== undefined) {
              const endIdx = match.index + match[0].length;
              const toSpeak = sentenceBuffer.slice(0, endIdx);
              sentenceBuffer = sentenceBuffer.slice(endIdx);
              if (toSpeak.trim() && !bargedInRef.current) {
                queueChunk(toSpeak);
              }
            }
          } catch {}
        }
      }

      // Speak remaining text
      if (sentenceBuffer.trim() && !bargedInRef.current && isActiveRef.current) {
        queueChunk(sentenceBuffer);
      }

      // Save to history
      if (fullReply) {
        historyRef.current.push({ role: "assistant", content: fullReply });
      }

      // Wait for speech queue to finish, then resume listening
      const waitForDone = () => {
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending && speakQueue.length === 0) {
          if (isActiveRef.current && !bargedInRef.current) {
            startListening();
          }
        } else if (isActiveRef.current) {
          setTimeout(waitForDone, 100);
        }
      };
      if (!bargedInRef.current && isActiveRef.current) {
        waitForDone();
      }
    } catch (err: any) {
      console.error("Voice stream error:", err);
      toast({ title: err.message ?? "Voice processing failed", variant: "destructive" });
      if (isActiveRef.current) startListening();
    }
  }, [stopMicLevelTracking, toast]);

  // ── Speech recognition ────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (!isActiveRef.current || isMutedRef.current) return;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast({ title: "SpeechRecognition not supported. Use Chrome.", variant: "destructive" });
      return;
    }

    speechBufferRef.current = "";
    clearSilenceTimer();

    const rec = new SR();
    recognitionRef.current = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.maxAlternatives = 1;

    setStatus("listening");
    startMicLevelTracking();

    rec.onresult = (e: any) => {
      let interim = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalText += t;
          speechBufferRef.current += " " + t;
        } else {
          interim += t;
        }
      }

      // Barge-in: user spoke while AI is speaking
      if ((finalText || interim) && statusRef.current === "speaking") {
        bargedInRef.current = true;
        stopSpeaking();
        setStatus("listening");
      }

      // Reset silence timer on every speech event
      if (finalText || interim) {
        clearSilenceTimer();
        silenceTimerRef.current = setTimeout(() => {
          const said = speechBufferRef.current.trim();
          speechBufferRef.current = "";
          rec.stop();
          if (said.length > 1) {
            streamAndSpeak(said);
          } else {
            startListening();
          }
        }, silenceCutoffRef.current);
      }
    };

    rec.onerror = (e: any) => {
      if (e.error === "no-speech" || e.error === "aborted") {
        if (isActiveRef.current && !isMutedRef.current) startListening();
      } else {
        toast({ title: `Mic error: ${e.error}`, variant: "destructive" });
      }
    };

    rec.onend = () => {
      if (isActiveRef.current && statusRef.current === "listening" && !silenceTimerRef.current && !isMutedRef.current) {
        startListening();
      }
    };

    rec.start();
  }, [stopSpeaking, streamAndSpeak, startMicLevelTracking, toast]);

  // ── Start / End call ──────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
    setStatus("connecting");
    historyRef.current = [];
    isActiveRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      setIsConnected(true);
      startListening();
    } catch (error) {
      console.error("Microphone error:", error);
      let errorMessage = "Could not access microphone";
      if (error instanceof Error) {
        if (error.name === "NotAllowedError") errorMessage = "Microphone access denied.";
        else if (error.name === "NotFoundError") errorMessage = "No microphone found.";
        else if (error.name === "NotReadableError") errorMessage = "Microphone in use.";
      }
      toast({ title: errorMessage, variant: "destructive" });
      setStatus("idle");
    }
  }, [startListening, toast]);

  const endCall = useCallback(() => {
    isActiveRef.current = false;
    clearSilenceTimer();
    recognitionRef.current?.abort();
    stopSpeaking();
    stopMicLevelTracking();

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setIsConnected(false);
    setStatus("idle");
    onClose();
  }, [onClose, stopSpeaking, stopMicLevelTracking]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    isMutedRef.current = next;

    if (next) {
      clearSilenceTimer();
      recognitionRef.current?.abort();
      stopSpeaking();
      stopMicLevelTracking();
      setStatus("idle");
    } else if (isConnected) {
      startListening();
    }
  }, [isMuted, isConnected, startListening, stopSpeaking, stopMicLevelTracking]);

  useEffect(() => {
    startCall();
    return () => {
      isActiveRef.current = false;
      recognitionRef.current?.abort();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusLabel =
    status === "connecting" ? "Connecting…" :
    status === "listening" ? "Listening…" :
    status === "speaking" ? "Speaking…" : "Ready";

  const feminineVoices = VOICE_OPTIONS.filter(v => v.gender === "feminine");
  const masculineVoices = VOICE_OPTIONS.filter(v => v.gender === "masculine");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black"
    >
      <div className="flex flex-col items-center gap-4 p-6 sm:p-8 max-w-md w-full h-full justify-between pt-12 pb-10">
        <div className="text-center">
          <p className="text-white/50 text-sm font-mono tracking-widest">{formatDuration(callDuration)}</p>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <VoiceOrb status={status} isMuted={isMuted} audioLevel={audioLevel} />
        </div>

        <div className="text-center mb-2">
          <p className={cn(
            "text-sm font-medium tracking-wide transition-colors",
            status === "speaking" ? "text-cyan-400" :
            status === "listening" ? "text-emerald-400" :
            "text-white/40"
          )}>
            {statusLabel}
          </p>
        </div>

        <div className="w-full rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-3 space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-white/70">
              <span>Silence cutoff</span>
              <span>{(silenceCutoff / 1000).toFixed(1)}s</span>
            </div>
            <Slider
              min={800}
              max={5500}
              step={100}
              value={[silenceCutoff]}
              onValueChange={(value) => setSilenceCutoff(value[0] ?? 2300)}
              aria-label="Silence cutoff in seconds"
            />
          </div>
        </div>

        <div className="flex items-center gap-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMute}
            className={cn(
              "h-14 w-14 rounded-full border transition-all",
              isMuted
                ? "border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                : "border-white/20 bg-white/5 text-white hover:bg-white/10"
            )}
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={endCall}
            className="h-16 w-16 rounded-full bg-red-500 hover:bg-red-600 text-white"
            aria-label="End call"
          >
            <PhoneOff className="h-7 w-7" />
          </Button>
        </div>

        {!isConnected && status !== "connecting" && (
          <Button variant="outline" onClick={startCall} className="w-full border-white/20 text-white hover:bg-white/10">
            Reconnect
          </Button>
        )}
      </div>
    </motion.div>
  );
};
