import { forwardRef, useRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { motion } from "framer-motion";
import { PhoneOff, Mic, MicOff, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { VoiceOrb } from "./VoiceOrb";
import { cleanTextForTTS } from "@/utils/cleanTextForTTS";
import { getAISettings, getModeSystemPrompt } from "@/lib/aiSettings";

interface VoiceCallProps {
  onClose: () => void;
  autoStart?: boolean;
}

export interface VoiceCallHandle {
  startFromTrigger: () => void;
}

const VOICE_BASE = `You are Astraz, a voice assistant on a phone call. Reply in at most 3 short sentences. No markdown, no lists, no emojis — speak naturally.`;
const buildVoiceSystem = () => {
  const s = getAISettings();
  const personality = getModeSystemPrompt(s.mode, s.customPrompt);
  return `${VOICE_BASE}\n\n${personality}\n\nKeep replies brief and conversational regardless of personality.`;
};

// Status: only listening / speaking. No connecting/processing — instant UX.
type CallStatus = "idle" | "listening" | "speaking";

const log = (label: string, data?: any) => {
  console.log(`[VoiceCall] ${label}`, data ?? "");
};

// Pick the best MediaRecorder mime for the device.
// iOS Safari supports audio/mp4; Chrome/Android/desktop prefer webm/opus.
const pickRecorderMime = (): string => {
  const ua = navigator.userAgent.toLowerCase();
  const preferMp4 = /iphone|ipad|ipod|safari/.test(ua) && !/chrome|crios|fxios|edgios/.test(ua);
  const candidates = preferMp4
    ? ["audio/mp4", "audio/mp4;codecs=mp4a.40.2", "audio/aac", "audio/webm;codecs=opus", "audio/webm"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mp4;codecs=mp4a.40.2", "audio/aac"];
  for (const c of candidates) {
    try {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
    } catch {}
  }
  return "";
};

// Split streaming text into speakable chunks at sentence/clause boundaries.
const SENTENCE_BOUNDARY = /([.!?…]+\s+|[,;:]\s+(?=\S{12,}))/;
const VOICE_SILENCE_MS = 800;
const EARLY_TTS_FLUSH_MS = 220;
const EARLY_TTS_MIN_CHARS = 48;
const INITIAL_SPEECH_WAIT_MS = 3200;
const MAX_RECORDING_MS = 14000;
const VOICE_ACTIVITY_THRESHOLD = 0.075;
const STT_TIMEOUT_MS = 12000;
const TTS_TIMEOUT_MS = 15000;

type TTSQueueItem = {
  text: string;
  blobPromise: Promise<Blob | null>;
};

export const VoiceCall = forwardRef<VoiceCallHandle, VoiceCallProps>(({ onClose, autoStart = false }, ref) => {
  const { toast } = useToast();
  const [callStart, setCallStart] = useState<number | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [isConnected, setIsConnected] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [startHint, setStartHint] = useState<string | null>(null);

  // Refs
  const isActiveRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isMutedRef = useRef(isMuted);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<{ role: string; content: string }[]>([]);
  const startListeningRef = useRef<() => void>(() => {});

  // MediaRecorder refs
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recorderMimeRef = useRef("audio/webm");

  // TTS playback pipeline
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const ttsQueueRef = useRef<TTSQueueItem[]>([]);
  const ttsPlayingRef = useRef(false);
  const cancelTokenRef = useRef(0);

  // Mic level tracking
  const audioContextRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micAnimFrameRef = useRef<number>(0);

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  useEffect(() => {
    if (!callStart) return;
    const t = setInterval(() => setCallDuration(Math.floor((Date.now() - callStart) / 1000)), 1000);
    return () => clearInterval(t);
  }, [callStart]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  // ── Cancel any in-flight TTS / playback (barge-in) ──
  const cancelPlayback = useCallback(() => {
    cancelTokenRef.current++;
    ttsQueueRef.current = [];
    ttsPlayingRef.current = false;
    isSpeakingRef.current = false;
    if (audioElRef.current) {
      try { audioElRef.current.pause(); } catch {}
      try { audioElRef.current.src = ""; } catch {}
    }
    setAudioLevel(0);
  }, []);

  // ── Mic level tracking ──
  const startMicLevelTracking = useCallback(() => {
    if (!streamRef.current || !audioContextRef.current) return;
    try {
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
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
          setAudioLevel(Math.min(1, (avg / 255) * 1.6));
        }
        micAnimFrameRef.current = requestAnimationFrame(update);
      };
      micAnimFrameRef.current = requestAnimationFrame(update);
    } catch (e) {
      log("Mic level tracking failed", e);
    }
  }, []);

  const stopMicLevelTracking = useCallback(() => {
    if (micAnimFrameRef.current) {
      cancelAnimationFrame(micAnimFrameRef.current);
      micAnimFrameRef.current = 0;
    }
    setAudioLevel(0);
  }, []);

  // ── STT ──
  const transcribeAudio = useCallback(async (audioBlob: Blob): Promise<string> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/speech-to-text`, {
      method: "POST",
      headers: {
        "Content-Type": recorderMimeRef.current || audioBlob.type || "application/octet-stream",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: audioBlob,
    });

    if (!response.ok) throw new Error(`STT failed: ${response.status}`);
    const { transcript, error } = await response.json();
    if (error) throw new Error(error);
    return transcript || "";
  }, []);

  // ── Fetch TTS audio for one chunk ──
  const fetchTTSBlob = useCallback(async (text: string): Promise<Blob | null> => {
    const cleaned = cleanTextForTTS(text);
    if (!cleaned || !cleaned.trim()) return null;

    const voiceId = localStorage.getItem("xai-tts-voice") || "asteria";
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ text: cleaned, voiceId }),
    });
    if (!response.ok) {
      log("TTS failed", response.status);
      return null;
    }
    return await response.blob();
  }, []);

  // ── Play one audio blob through the unlocked <audio> element ──
  const playBlob = useCallback((blob: Blob, token: number): Promise<void> => {
    return new Promise<void>((resolve) => {
      if (token !== cancelTokenRef.current || !isActiveRef.current) { resolve(); return; }
      const url = URL.createObjectURL(blob);
      const audio = audioElRef.current;
      if (!audio) { URL.revokeObjectURL(url); resolve(); return; }

      let animInterval: ReturnType<typeof setInterval> | null = null;
      const cleanup = () => {
        if (animInterval) { clearInterval(animInterval); animInterval = null; }
        setAudioLevel(0);
        URL.revokeObjectURL(url);
        audio.onended = null;
        audio.onerror = null;
        resolve();
      };

      audio.onended = cleanup;
      audio.onerror = () => { log("audio el error"); cleanup(); };
      audio.src = url;

      // Animate audio level during playback
      animInterval = setInterval(() => {
        if (isSpeakingRef.current && token === cancelTokenRef.current) {
          setAudioLevel(0.3 + Math.random() * 0.5);
        }
      }, 80);

      audio.play().catch((e) => {
        log("audio.play() rejected", e?.message);
        cleanup();
      });
    });
  }, []);

  // ── Sequential TTS queue processor ──
  const processTTSQueue = useCallback(async (token: number) => {
    if (ttsPlayingRef.current) return;
    ttsPlayingRef.current = true;
    try {
      while (ttsQueueRef.current.length > 0) {
        if (token !== cancelTokenRef.current || !isActiveRef.current) break;
        const next = ttsQueueRef.current.shift()!;
        const blob = await next.blobPromise;
        if (!blob) continue;
        if (token !== cancelTokenRef.current || !isActiveRef.current) break;
        await playBlob(blob, token);
      }
    } finally {
      ttsPlayingRef.current = false;
    }
  }, [fetchTTSBlob, playBlob]);

  const enqueueTTS = useCallback((text: string, token: number) => {
    if (!text.trim()) return;
    ttsQueueRef.current.push({
      text,
      blobPromise: fetchTTSBlob(text),
    });
    // kick the processor
    void processTTSQueue(token);
  }, [fetchTTSBlob, processTTSQueue]);

  // ── Streaming AI → chunked TTS ──
  const streamAIAndSpeak = useCallback(async (userText: string) => {
    if (!isActiveRef.current) return;

    historyRef.current.push({ role: "user", content: userText });

    // Go straight to "speaking" — no connecting/thinking UI.
    setStatus("speaking");
    isSpeakingRef.current = true;
    stopMicLevelTracking();

    // New cancel token for this turn
    cancelTokenRef.current++;
    const token = cancelTokenRef.current;
    ttsQueueRef.current = [];

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: buildVoiceSystem() },
            ...historyRef.current.map(({ role, content }) => ({ role, content })),
          ],
          isVoiceMode: true,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          clientTimeISO: new Date().toISOString(),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok || !res.body) throw new Error(`API ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let pending = "";
      let fullReply = "";
      let streamDone = false;
      let firstChunkQueued = false;
      let earlyFlushTimer: ReturnType<typeof setTimeout> | null = null;

      const clearEarlyFlushTimer = () => {
        if (earlyFlushTimer) {
          clearTimeout(earlyFlushTimer);
          earlyFlushTimer = null;
        }
      };

      const flushChunk = (force = false) => {
        if (token !== cancelTokenRef.current) return;
        clearEarlyFlushTimer();
        // emit as many sentence-bounded chunks as possible
        while (true) {
          const m = pending.match(SENTENCE_BOUNDARY);
          if (!m || m.index === undefined) break;
          const cut = m.index + m[0].length;
          const chunk = pending.slice(0, cut).trim();
          pending = pending.slice(cut);
          if (chunk) {
            enqueueTTS(chunk, token);
            firstChunkQueued = true;
          }
        }
        if (force && pending.trim()) {
          enqueueTTS(pending.trim(), token);
          firstChunkQueued = true;
          pending = "";
        } else if (!force && pending.length > 140) {
          // safety: if we keep getting tokens with no boundary, flush early
          enqueueTTS(pending.trim(), token);
          firstChunkQueued = true;
          pending = "";
        } else if (!force && !firstChunkQueued && pending.trim().length >= EARLY_TTS_MIN_CHARS && !earlyFlushTimer) {
          earlyFlushTimer = setTimeout(() => {
            if (token !== cancelTokenRef.current || !pending.trim()) return;
            enqueueTTS(pending.trim(), token);
            firstChunkQueued = true;
            pending = "";
            earlyFlushTimer = null;
          }, EARLY_TTS_FLUSH_MS);
        }
      };

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        if (token !== cancelTokenRef.current) { try { reader.cancel(); } catch {}; break; }
        textBuffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, nl);
          textBuffer = textBuffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content
              || parsed.choices?.[0]?.message?.content
              || "";
            if (delta) {
              fullReply += delta;
              pending += delta;
              flushChunk(false);
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      clearEarlyFlushTimer();
      flushChunk(true);

      if (!fullReply.trim()) {
        enqueueTTS("I didn't catch that. Could you say it again?", token);
      } else {
        historyRef.current.push({ role: "assistant", content: fullReply.trim() });
      }

      // Wait for queue to drain before re-listening
      while (
        token === cancelTokenRef.current &&
        isActiveRef.current &&
        (ttsPlayingRef.current || ttsQueueRef.current.length > 0)
      ) {
        await new Promise((r) => setTimeout(r, 60));
      }
    } catch (err: any) {
      const msg = err?.name === "AbortError" ? "Response timed out" : (err?.message ?? "Voice processing failed");
      log("streamAIAndSpeak error", msg);
      toast({ title: msg, variant: "destructive" });
    }

    isSpeakingRef.current = false;
    setAudioLevel(0);
    if (isActiveRef.current && !isMutedRef.current && token === cancelTokenRef.current) {
      // Tiny gap then back to listening
      setTimeout(() => startListeningRef.current(), 120);
    }
  }, [enqueueTTS, stopMicLevelTracking, toast]);

  // ── Listening (MediaRecorder) ──
  const startListening = useCallback(() => {
    if (!isActiveRef.current || isMutedRef.current) return;
    if (!streamRef.current) return;

    if (isSpeakingRef.current) cancelPlayback();

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch {}
    }

    setStatus("listening");
    startMicLevelTracking();
    audioChunksRef.current = [];

    const mimeType = recorderMimeRef.current;
    const recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    let hasAudio = false;
    let stopped = false;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunksRef.current.push(e.data);
        hasAudio = true;
      }
    };

    recorder.onstop = async () => {
      stopped = true;
      clearSilenceTimer();
      stopMicLevelTracking();
      if (!isActiveRef.current) return;

      if (!hasAudio || audioChunksRef.current.length === 0) {
        if (isActiveRef.current && !isMutedRef.current && !isSpeakingRef.current) {
          setTimeout(() => startListening(), 250);
        }
        return;
      }

      const audioBlob = new Blob(audioChunksRef.current, { type: recorderMimeRef.current });
      log("Captured", { size: audioBlob.size, mime: recorderMimeRef.current });

      if (audioBlob.size < 1500) {
        if (isActiveRef.current && !isMutedRef.current && !isSpeakingRef.current) {
          setTimeout(() => startListening(), 250);
        }
        return;
      }

      try {
        // Don't switch to "connecting" — keep listening label briefly until first audio plays
        const transcript = await transcribeAudio(audioBlob);
        log("Transcript", transcript);
        if (transcript && transcript.trim().length > 1) {
          await streamAIAndSpeak(transcript.trim());
        } else if (isActiveRef.current && !isMutedRef.current && !isSpeakingRef.current) {
          startListening();
        }
      } catch (err: any) {
        log("STT err", err?.message);
        if (isActiveRef.current && !isMutedRef.current && !isSpeakingRef.current) {
          setTimeout(() => startListening(), 600);
        }
      }
    };

    recorder.onerror = () => {
      if (!stopped && isActiveRef.current && !isMutedRef.current) {
        setTimeout(() => startListening(), 600);
      }
    };

    try {
      recorder.start(250);
    } catch (e) {
      log("recorder.start failed", e);
      setTimeout(() => { if (isActiveRef.current) startListening(); }, 800);
      return;
    }

    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      if (recorder.state === "recording") {
        try { recorder.stop(); } catch {}
      }
    }, VOICE_SILENCE_MS);
  }, [cancelPlayback, startMicLevelTracking, stopMicLevelTracking, transcribeAudio, streamAIAndSpeak]);

  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);

  // ── Start call: MUST be invoked synchronously from a user gesture ──
  const startCall = useCallback(async () => {
    if (isActiveRef.current || isStarting) return;
    historyRef.current = [];
    setIsStarting(true);
    setStartHint("Requesting microphone access…");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Media devices are not available on this browser");
      }

      if (navigator.permissions?.query) {
        try {
          const permission = await navigator.permissions.query({ name: "microphone" as PermissionName });
          if (permission.state === "denied") {
            throw Object.assign(new Error("Microphone access denied"), { name: "NotAllowedError" });
          }
        } catch {
          // Ignore browsers that don't support microphone permission checks cleanly.
        }
      }

      // 1) Synchronously create + unlock AudioContext (iOS requirement)
      const Ctx: typeof AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx({ latencyHint: "interactive", sampleRate: 16000 });
      audioContextRef.current = ctx;
      setStartHint("Unlocking speaker…");
      try { await ctx.resume(); } catch {}

      // 2) Synchronously create + unlock <audio> element by playing a silent buffer
      let audioEl = audioElRef.current;
      if (!audioEl) {
        audioEl = document.createElement("audio");
        audioEl.setAttribute("playsinline", "true");
        audioEl.setAttribute("webkit-playsinline", "true");
        audioEl.preload = "auto";
        audioEl.autoplay = false;
        // a silent 1-frame WAV to unlock playback on iOS
        audioEl.src =
          "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
        audioElRef.current = audioEl;
      }
      try { await audioEl.play(); audioEl.pause(); audioEl.currentTime = 0; } catch {}

      // 3) Mic
      setStartHint("Starting microphone…");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      // 4) Resolve recorder mime once
      recorderMimeRef.current = pickRecorderMime() || "audio/webm";
      log("Recorder mime", recorderMimeRef.current);

      isActiveRef.current = true;
      setIsConnected(true);
      setCallStart(Date.now());
      setStartHint(null);
      startListening();
    } catch (error: any) {
      let errorMessage = "Could not access microphone";
      if (error?.name === "NotAllowedError") errorMessage = "Microphone access denied. Check browser settings.";
      else if (error?.name === "NotFoundError") errorMessage = "No microphone found on this device.";
      else if (error?.name === "NotReadableError") errorMessage = "Microphone is in use by another app.";
      else if (error?.message) errorMessage = error.message;
      toast({ title: errorMessage, variant: "destructive" });
      setStartHint(errorMessage);
      setStatus("idle");
    } finally {
      setIsStarting(false);
    }
  }, [isStarting, startListening, toast]);

  const endCall = useCallback(() => {
    isActiveRef.current = false;
    clearSilenceTimer();
    cancelPlayback();

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch {}
    }
    recorderRef.current = null;

    stopMicLevelTracking();

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    audioElRef.current = null;

    setIsConnected(false);
    setStatus("idle");
    onClose();
  }, [onClose, cancelPlayback, stopMicLevelTracking]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    isMutedRef.current = next;

    if (next) {
      clearSilenceTimer();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try { recorderRef.current.stop(); } catch {}
      }
      cancelPlayback();
      stopMicLevelTracking();
      setStatus("idle");
    } else if (isConnected) {
      startListening();
    }
  }, [isMuted, isConnected, startListening, cancelPlayback, stopMicLevelTracking]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isActiveRef.current = false;
      cancelTokenRef.current++;
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try { recorderRef.current.stop(); } catch {}
      }
      if (audioElRef.current) {
        try { audioElRef.current.pause(); } catch {}
      }
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusLabel =
    status === "listening" ? "Listening…" :
    status === "speaking" ? "Speaking…" : "Ready";

  // Pre-call screen — required for iOS audio unlock via direct user gesture
  if (!isConnected) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0d0d1a 50%, #0a0a0f 100%)" }}
      >
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="text-center">
            <p className="text-white/40 text-xs font-mono tracking-[0.3em] uppercase">Astraz Voice</p>
            <p className="text-white/70 text-base mt-3">Tap to start your call</p>
            <p className="mt-2 text-xs text-white/35">{startHint ?? "Optimized for iPhone, Android, and desktop."}</p>
          </div>

          <VoiceOrb status="idle" isMuted={false} audioLevel={0} />

          <div className="flex items-center gap-6">
            <Button
              onClick={startCall}
              disabled={isStarting}
              className="h-16 w-16 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-[0_0_30px_-5px_rgba(16,185,129,0.5)] disabled:opacity-100"
              aria-label="Start call"
            >
              <motion.div
                animate={isStarting ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                transition={{ duration: 0.9, repeat: isStarting ? Infinity : 0, ease: "easeInOut" }}
              >
                <Phone className="h-7 w-7" />
              </motion.div>
            </Button>
            <Button
              variant="ghost"
              onClick={onClose}
              className="h-12 px-5 rounded-full border border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
            >
              Cancel
            </Button>
          </div>

          <p className="text-white/30 text-xs text-center max-w-xs">
            Tapping start unlocks audio on iOS and grants microphone access. Streaming begins instantly.
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0d0d1a 50%, #0a0a0f 100%)" }}
    >
      <div className="flex flex-col items-center gap-4 p-6 sm:p-8 max-w-md w-full h-full justify-between pt-12 pb-10">
        <div className="text-center">
          <p className="text-white/40 text-xs font-mono tracking-[0.3em] uppercase">Astraz Voice</p>
          <p className="text-white/60 text-sm font-mono tracking-widest mt-1">{formatDuration(callDuration)}</p>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <VoiceOrb status={status} isMuted={isMuted} audioLevel={audioLevel} />
        </div>

        <div className="text-center mb-2">
          <p className={cn(
            "text-sm font-medium tracking-wide transition-colors duration-300",
            status === "speaking" ? "text-cyan-400" :
            status === "listening" ? "text-emerald-400" :
            "text-white/40"
          )}>
            {statusLabel}
          </p>
        </div>

        <div className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm p-4">
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.24em] text-white/45">
            <span>Realtime voice</span>
            <span className="font-mono text-white/60">0.8s turn cutoff</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMute}
            className={cn(
              "h-14 w-14 rounded-full border transition-all duration-300",
              isMuted
                ? "border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
            )}
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={endCall}
            className="h-16 w-16 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-[0_0_30px_-5px_rgba(239,68,68,0.4)] transition-all duration-300"
            aria-label="End call"
          >
            <PhoneOff className="h-7 w-7" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
};
