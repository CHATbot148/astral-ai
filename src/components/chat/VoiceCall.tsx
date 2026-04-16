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

const isMobile = () => /iphone|ipad|ipod|android/i.test(navigator.userAgent);

const log = (label: string, data?: any) => {
  console.log(`[VoiceCall] ${label}`, data ?? "");
};

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
  const startListeningRef = useRef<() => void>(() => {});
  const speakQueueRef = useRef<string[]>([]);
  const streamDoneRef = useRef(false);
  const ttsUnlockedRef = useRef(false);
  const ttsWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const clearTtsWatchdog = () => {
    if (ttsWatchdogRef.current) {
      clearTimeout(ttsWatchdogRef.current);
      ttsWatchdogRef.current = null;
    }
  };

  const unlockTTS = useCallback(() => {
    if (ttsUnlockedRef.current) return;
    ttsUnlockedRef.current = true;
    try {
      const utter = new SpeechSynthesisUtterance("");
      utter.volume = 0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } catch {
      // ignore unlock failures
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    isSpeakingRef.current = false;
    speakQueueRef.current = [];
    streamDoneRef.current = false;
    clearTtsWatchdog();
    try { window.speechSynthesis?.cancel(); } catch {}
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

  const finalizeSpeechTurn = useCallback(() => {
    clearTtsWatchdog();
    if (!isActiveRef.current) return;
    isSpeakingRef.current = false;
    setAudioLevel(0);
    log("finalizeSpeechTurn → will restart listening");
    const delay = isMobile() ? 400 : 250;
    setTimeout(() => {
      if (isActiveRef.current && !isMutedRef.current) {
        startListeningRef.current();
      }
    }, delay);
  }, []);

  // ── TTS: speak queued chunks sequentially ──
  const speakNextChunk = useCallback(() => {
    if (!isActiveRef.current || !isSpeakingRef.current) return;

    const nextChunk = speakQueueRef.current.shift();
    if (!nextChunk) {
      if (streamDoneRef.current) finalizeSpeechTurn();
      return;
    }

    const synth = window.speechSynthesis;
    try { synth.cancel(); } catch {}

    const utter = new SpeechSynthesisUtterance(nextChunk.trim());
    utter.rate = 1.02;
    utter.pitch = 1;
    utter.volume = 1;

    const voices = synth.getVoices();
    const preferred = voices.find((v) =>
      ["Samantha", "Google UK English Female", "Microsoft Aria", "Karen", "Moira", "Nicky"]
        .some((n) => v.name.includes(n))
    );
    if (preferred) utter.voice = preferred;

    let speakInterval: ReturnType<typeof setInterval> | null = null;
    let hasStarted = false;
    let doneHandled = false;

    const handleDone = () => {
      if (doneHandled) return;
      doneHandled = true;
      clearTtsWatchdog();
      if (speakInterval) { clearInterval(speakInterval); speakInterval = null; }
      setAudioLevel(0);
      hasStarted = false;
      if (!isActiveRef.current || !isSpeakingRef.current) return;
      // Small delay to avoid overlap, especially on mobile
      setTimeout(() => speakNextChunk(), 150);
    };

    utter.onstart = () => {
      hasStarted = true;
      log("TTS onstart", nextChunk.slice(0, 30));
      setStatus("speaking");
      speakInterval = setInterval(() => {
        if (!window.speechSynthesis.speaking || !isSpeakingRef.current) {
          if (speakInterval) clearInterval(speakInterval);
          return;
        }
        setAudioLevel(0.2 + Math.random() * 0.6);
      }, 100);
    };

    utter.onend = () => {
      log("TTS onend");
      handleDone();
    };
    utter.onerror = (event: any) => {
      log("TTS onerror", event?.error);
      handleDone();
    };

    // Watchdog: if TTS silently dies (common on mobile), force advance
    const estimatedMs = Math.max(2500, (nextChunk.length / 11) * 1000 + 2000);
    ttsWatchdogRef.current = setTimeout(() => {
      if (!synth.speaking && !synth.pending) {
        log("TTS watchdog triggered");
        handleDone();
      }
    }, estimatedMs);

    try {
      synth.speak(utter);
      // iOS Safari: sometimes speak() is a no-op from async context.
      // If after 500ms nothing started, force advance.
      if (isMobile()) {
        setTimeout(() => {
          if (!hasStarted && !doneHandled) {
            log("TTS mobile: onstart never fired, forcing advance");
            handleDone();
          }
        }, 600);
      }
    } catch (e) {
      log("TTS speak() threw", e);
      handleDone();
    }
  }, [finalizeSpeechTurn]);

  // ── Stream response, push phrases to speech queue eagerly ──
  const streamAndSpeak = useCallback(async (userText: string) => {
    if (!isActiveRef.current) return;

    historyRef.current.push({ role: "user", content: userText });
    setStatus("speaking");
    isSpeakingRef.current = true;
    streamDoneRef.current = false;
    speakQueueRef.current = [];
    stopMicLevelTracking();

    let fullReply = "";
    let charBuffer = "";
    let charCount = 0;

    // Collect all chunks first on mobile (sequential playback is more reliable),
    // stream eagerly on desktop.
    const collectFirst = isMobile();
    const collectedChunks: string[] = [];

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

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
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      if (!res.ok) throw new Error(`API ${res.status}`);
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      const pushPhrase = (phrase: string) => {
        if (!phrase || !isSpeakingRef.current) return;
        if (collectFirst) {
          collectedChunks.push(phrase);
        } else {
          const shouldStart = speakQueueRef.current.length === 0 &&
            !window.speechSynthesis.speaking && !window.speechSynthesis.pending;
          speakQueueRef.current.push(phrase);
          if (shouldStart) speakNextChunk();
        }
      };

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
            charBuffer += content;
            charCount += content.length;

            // Push every ~40 chars or at sentence boundaries for low latency
            const sentenceMatch = /[.!?…]\s*$/.test(charBuffer);
            if (charCount >= 40 || sentenceMatch) {
              const phrase = charBuffer.trim();
              charBuffer = "";
              charCount = 0;
              pushPhrase(phrase);
            }
          } catch {}
        }
      }

      // Flush remaining buffer
      if (charBuffer.trim()) {
        pushPhrase(charBuffer.trim());
      }

      if (fullReply) {
        historyRef.current.push({ role: "assistant", content: fullReply });
      }

      // Mobile: now play all collected chunks sequentially
      if (collectFirst && collectedChunks.length > 0 && isSpeakingRef.current) {
        log("Mobile: playing collected chunks", collectedChunks.length);
        speakQueueRef.current = collectedChunks;
        streamDoneRef.current = true;
        speakNextChunk();
        return;
      }

      streamDoneRef.current = true;
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending && speakQueueRef.current.length === 0) {
        finalizeSpeechTurn();
      }
    } catch (err: any) {
      isSpeakingRef.current = false;
      const msg = err?.name === "AbortError" ? "Response timed out" : (err?.message ?? "Voice processing failed");
      log("streamAndSpeak error", msg);
      toast({ title: msg, variant: "destructive" });
      if (isActiveRef.current) setTimeout(() => startListeningRef.current(), 600);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalizeSpeechTurn, speakNextChunk, stopMicLevelTracking, toast]);

  // ── Speech recognition ──
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
    rec._failureCount = 0;
    recognitionRef.current = rec;
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.maxAlternatives = 1;

    let finalTranscript = "";
    let hasReceivedFinal = false;
    let onEndHandled = false;
    setStatus("listening");
    startMicLevelTracking();

    rec.onstart = () => {
      log("rec.onstart");
    };

    rec.onspeechstart = () => {
      // Barge-in: if TTS is playing, kill it immediately
      if (isSpeakingRef.current) {
        log("Barge-in detected");
        stopSpeaking();
        setStatus("listening");
      }
    };

    rec.onresult = (e: any) => {
      if (rec._dead) return;

      // Barge-in on result too
      if (isSpeakingRef.current) {
        stopSpeaking();
        setStatus("listening");
      }

      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTranscript += e.results[i][0].transcript;
          hasReceivedFinal = true;
        }
      }

      // Reset silence gate on every speech event
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => {
        if (rec._dead || !isActiveRef.current) return;
        log("Silence cutoff reached, stopping rec");
        rec._dead = true;
        try { rec.stop(); } catch {
          try { rec.abort(); } catch {}
        }
        // Mobile fallback: if onend doesn't fire within 1s, handle manually
        if (isMobile()) {
          setTimeout(() => {
            if (!onEndHandled && isActiveRef.current) {
              log("Mobile: onend didn't fire, handling manually");
              handleOnEnd();
            }
          }, 1000);
        }
      }, silenceCutoffRef.current);
    };

    const handleOnEnd = () => {
      if (onEndHandled) return;
      onEndHandled = true;
      clearSilenceTimer();
      stopMicLevelTracking();
      if (!isActiveRef.current) return;

      const said = finalTranscript.trim();
      log("handleOnEnd", { said, hasReceivedFinal });

      if (said.length > 1 && hasReceivedFinal) {
        streamAndSpeak(said);
      } else {
        // Nothing heard — restart after pause
        const pauseMs = isMobile() ? 800 : 500;
        setTimeout(() => {
          if (isActiveRef.current && !isSpeakingRef.current && !isMutedRef.current) {
            startListening();
          }
        }, pauseMs);
      }
    };

    rec.onend = () => {
      log("rec.onend");
      handleOnEnd();
    };

    rec.onerror = (e: any) => {
      if (rec._dead) return;
      log("rec.onerror", e.error);
      clearSilenceTimer();

      const mobileRetryable = isMobile() && (
        e.error === "no-speech" || e.error === "network" || e.error === "unknown"
      );

      if (mobileRetryable) {
        rec._failureCount = (rec._failureCount || 0) + 1;
        const backoffMs = Math.min(2000, 500 * rec._failureCount);
        if (isActiveRef.current && !isMutedRef.current && !isSpeakingRef.current) {
          setTimeout(() => startListening(), backoffMs);
        }
      } else if (e.error === "aborted" || e.error === "no-speech") {
        if (isActiveRef.current && !isMutedRef.current && !isSpeakingRef.current) {
          setTimeout(() => startListening(), 800);
        }
      } else if (e.error === "not-allowed") {
        rec._dead = true;
        toast({ title: "Microphone access denied. Check permissions.", variant: "destructive" });
      } else {
        rec._dead = true;
        toast({ title: `Mic error: ${e.error}`, variant: "destructive" });
      }
    };

    try {
      rec.start();
    } catch {
      setTimeout(() => startListening(), 1000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopSpeaking, startMicLevelTracking, stopMicLevelTracking, toast]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  // ── Start / End call ──
  const startCall = useCallback(async () => {
    setStatus("connecting");
    historyRef.current = [];
    isActiveRef.current = true;
    unlockTTS();

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
  }, [startListening, toast, unlockTTS]);

  const endCall = useCallback(() => {
    isActiveRef.current = false;
    clearSilenceTimer();
    clearTtsWatchdog();

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
      clearTtsWatchdog();
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
