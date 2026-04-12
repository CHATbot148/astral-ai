import { useRef, useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
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

const SYSTEM = `You are a concise AI voice assistant called Astraz. Max 3 sentences per reply. No markdown, no lists. Speak naturally as in a phone call.`;

type CallStatus = "idle" | "connecting" | "listening" | "speaking";

export const VoiceCall = ({ onClose }: VoiceCallProps) => {
  const { toast } = useToast();
  const [callStart] = useState(() => Date.now());
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [silenceCutoff, setSilenceCutoff] = useState<number>(() => {
    const saved = Number(localStorage.getItem("xai-voice-silence-cutoff-ms"));
    return Number.isFinite(saved) ? Math.min(5500, Math.max(800, saved)) : 2300;
  });
  const [status, setStatus] = useState<CallStatus>("idle");
  const [isConnected, setIsConnected] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  // Refs
  const isActiveRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isMutedRef = useRef(isMuted);
  const silenceCutoffRef = useRef(silenceCutoff);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<{ role: string; content: string }[]>([]);
  const recognitionRef = useRef<any>(null);

  // Mic level tracking
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micAnimFrameRef = useRef<number>(0);

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
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

  // ── Helpers ──
  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const stopSpeaking = useCallback(() => {
    isSpeakingRef.current = false;
    window.speechSynthesis?.cancel();
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
        if (!isSpeakingRef.current) {
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
    isSpeakingRef.current = true;

    let fullReply = "";
    let sentenceBuffer = "";
    const sentenceEnd = /[.!?…]+\s*/;

    const speakChunk = (text: string) => {
      if (!isActiveRef.current || !isSpeakingRef.current) return;
      const utter = new SpeechSynthesisUtterance(text.trim());
      utter.rate = 1.05;
      utter.pitch = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v =>
        ["Samantha", "Google UK English Female", "Microsoft Aria", "Karen", "Moira"]
          .some(n => v.name.includes(n))
      );
      if (preferred) utter.voice = preferred;

      // Simulate audio level while speaking
      let speakInterval: ReturnType<typeof setInterval> | null = null;
      speakInterval = setInterval(() => {
        if (!window.speechSynthesis.speaking || !isSpeakingRef.current) {
          if (speakInterval) clearInterval(speakInterval);
          return;
        }
        setAudioLevel(0.3 + Math.random() * 0.5);
      }, 80);

      utter.onend = () => {
        if (speakInterval) clearInterval(speakInterval);
        setAudioLevel(0);
      };
      utter.onerror = () => {
        if (speakInterval) clearInterval(speakInterval);
        setAudioLevel(0);
      };

      window.speechSynthesis.speak(utter);
    };

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      };

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: [
            { role: "system", content: SYSTEM },
            ...historyRef.current.map(({ role, content }) => ({ role, content })),
          ],
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
        if (!isActiveRef.current) { reader.cancel(); break; }

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

            let match: RegExpExecArray | null;
            while ((match = sentenceEnd.exec(sentenceBuffer)) !== null) {
              const end = match.index + match[0].length;
              const chunk = sentenceBuffer.slice(0, end);
              sentenceBuffer = sentenceBuffer.slice(end);
              if (chunk.trim() && isSpeakingRef.current) speakChunk(chunk);
            }
          } catch {}
        }
      }

      if (sentenceBuffer.trim() && isSpeakingRef.current) speakChunk(sentenceBuffer);

      if (fullReply) {
        historyRef.current.push({ role: "assistant", content: fullReply });
      }

      // Poll until synth is done, then resume listening
      const waitDone = setInterval(() => {
        if (!isActiveRef.current) { clearInterval(waitDone); return; }
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
          clearInterval(waitDone);
          isSpeakingRef.current = false;
          if (isActiveRef.current) startListening();
        }
      }, 150);
    } catch (err: any) {
      isSpeakingRef.current = false;
      console.error("Voice stream error:", err);
      toast({ title: err.message ?? "Voice processing failed", variant: "destructive" });
      if (isActiveRef.current) setTimeout(() => startListening(), 500);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  // ── Speech recognition (single-shot, NOT continuous) ──
  const startListening = useCallback(() => {
    if (!isActiveRef.current || isMutedRef.current) return;

    // Kill previous session cleanly
    if (recognitionRef.current) {
      recognitionRef.current._dead = true;
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast({ title: "SpeechRecognition not supported. Use Chrome or Safari.", variant: "destructive" });
      return;
    }

    const rec = new SR();
    rec._dead = false;
    recognitionRef.current = rec;
    rec.continuous = false;      // single utterance — avoids continuous CPU drain on mobile
    rec.interimResults = false;  // iOS Safari struggles with interim — use final only
    rec.lang = "en-US";
    rec.maxAlternatives = 1;

    let finalTranscript = "";
    setStatus("listening");
    startMicLevelTracking();

    rec.onresult = (e: any) => {
      if (rec._dead) return;

      // Barge-in: kill TTS the instant user starts speaking
      if (isSpeakingRef.current) {
        stopSpeaking();
        setStatus("listening");
      }

      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTranscript += e.results[i][0].transcript;
        }
      }

      // Reset silence gate on every speech event
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => {
        if (rec._dead || !isActiveRef.current) return;
        rec._dead = true;
        try { rec.stop(); } catch {}
      }, silenceCutoffRef.current);
    };

    // Extra barge-in hook
    rec.onspeechstart = () => {
      if (isSpeakingRef.current) {
        stopSpeaking();
        setStatus("listening");
      }
    };

    rec.onend = () => {
      clearSilenceTimer();
      stopMicLevelTracking();
      if (!isActiveRef.current) return;

      const said = finalTranscript.trim();
      if (said.length > 1) {
        streamAndSpeak(said);
      } else {
        // Nothing heard — restart after small pause
        setTimeout(() => startListening(), 600);
      }
    };

    rec.onerror = (e: any) => {
      if (rec._dead) return;
      rec._dead = true;
      clearSilenceTimer();
      if (e.error === "aborted" || e.error === "no-speech" || e.error === "not-allowed") {
        if (isActiveRef.current && !isMutedRef.current) setTimeout(() => startListening(), 800);
      } else {
        toast({ title: `Mic error: ${e.error}`, variant: "destructive" });
      }
    };

    try {
      rec.start();
    } catch {
      setTimeout(() => startListening(), 800);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopSpeaking, startMicLevelTracking, stopMicLevelTracking, toast]);

  // ── Start / End call ──
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

    if (recognitionRef.current) {
      recognitionRef.current._dead = true;
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }

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
      if (recognitionRef.current) {
        recognitionRef.current._dead = true;
        try { recognitionRef.current.abort(); } catch {}
        recognitionRef.current = null;
      }
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
      if (recognitionRef.current) {
        recognitionRef.current._dead = true;
        try { recognitionRef.current.abort(); } catch {}
      }
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusLabel =
    status === "connecting" ? "Connecting…" :
    status === "listening" ? "Listening…" :
    status === "speaking" ? "Speaking…" : "Ready";

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
