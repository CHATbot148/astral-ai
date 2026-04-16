import { useRef, useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PhoneOff, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { VoiceOrb } from "./VoiceOrb";
import { cleanTextForTTS } from "@/utils/cleanTextForTTS";

interface VoiceCallProps {
  onClose: () => void;
}

const SYSTEM = `You are a concise AI voice assistant called Astraz. Max 3 sentences per reply. No markdown, no lists, no emojis. Speak naturally as in a phone call.`;

type CallStatus = "idle" | "connecting" | "listening" | "speaking";

const log = (label: string, data?: any) => {
  console.log(`[VoiceCall] ${label}`, data ?? "");
};

/**
 * Fully server-side voice call: MediaRecorder → Deepgram STT → AI chat → Deepgram TTS → Audio element.
 * No browser SpeechRecognition or SpeechSynthesis used at all.
 */
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
  const startListeningRef = useRef<() => void>(() => {});

  // MediaRecorder refs
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recorderMimeRef = useRef("audio/webm");

  // Audio playback ref
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);

  // Mic level tracking
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

  const stopPlayback = useCallback(() => {
    isSpeakingRef.current = false;
    if (playbackAudioRef.current) {
      try { playbackAudioRef.current.pause(); } catch {}
      playbackAudioRef.current.src = "";
      playbackAudioRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  // ── Mic level tracking via AudioContext analyser ──
  const startMicLevelTracking = useCallback(() => {
    if (!streamRef.current) return;
    try {
      const ctx = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume();
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

  // ── Server-side STT: send recorded audio to Deepgram via edge function ──
  const transcribeAudio = useCallback(async (audioBlob: Blob): Promise<string> => {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64Audio = btoa(binary);

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/speech-to-text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ audio: base64Audio, mimeType: recorderMimeRef.current }),
    });

    if (!response.ok) throw new Error(`STT failed: ${response.status}`);
    const { transcript, error } = await response.json();
    if (error) throw new Error(error);
    return transcript || "";
  }, []);

  // ── Server-side TTS: get audio from Deepgram Aura via edge function, play via Audio element ──
  const speakServerAudio = useCallback(async (text: string): Promise<void> => {
    if (!isActiveRef.current) return;
    const cleaned = cleanTextForTTS(text);
    if (!cleaned) return;

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

    if (!response.ok) throw new Error(`TTS failed: ${response.status}`);
    const ct = response.headers.get("content-type") || "";
    if (!ct.includes("audio")) throw new Error("TTS did not return audio");

    const audioBlob = await response.blob();
    const url = URL.createObjectURL(audioBlob);

    return new Promise<void>((resolve) => {
      if (!isActiveRef.current || !isSpeakingRef.current) {
        URL.revokeObjectURL(url);
        resolve();
        return;
      }

      const audio = new Audio(url);
      playbackAudioRef.current = audio;

      // Animate audio level during playback
      let animInterval: ReturnType<typeof setInterval> | null = null;
      audio.onplay = () => {
        animInterval = setInterval(() => {
          if (isSpeakingRef.current) {
            setAudioLevel(0.3 + Math.random() * 0.5);
          }
        }, 80);
      };

      const cleanup = () => {
        if (animInterval) clearInterval(animInterval);
        setAudioLevel(0);
        URL.revokeObjectURL(url);
        playbackAudioRef.current = null;
        resolve();
      };

      audio.onended = cleanup;
      audio.onerror = () => {
        log("Audio playback error");
        cleanup();
      };

      audio.play().catch(() => {
        log("Audio.play() rejected");
        cleanup();
      });
    });
  }, []);

  // ── Get AI response (non-streaming for voice) then speak via server TTS ──
  const getResponseAndSpeak = useCallback(async (userText: string) => {
    if (!isActiveRef.current) return;

    historyRef.current.push({ role: "user", content: userText });
    setStatus("speaking");
    isSpeakingRef.current = true;
    stopMicLevelTracking();

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      // Use non-streaming mode for voice to get full text quickly
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: SYSTEM },
            ...historyRef.current.map(({ role, content }) => ({ role, content })),
          ],
          isVoiceMode: true,
          noStream: true,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          clientTimeISO: new Date().toISOString(),
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      if (!res.ok) throw new Error(`API ${res.status}`);

      // The chat function in noStream + voice mode returns an SSE-like payload.
      // Parse the text content from it.
      const rawText = await res.text();
      let fullReply = "";

      // Try to extract from SSE format
      const lines = rawText.split("\n").filter(l => l.startsWith("data: "));
      for (const line of lines) {
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.message?.content;
          if (content) fullReply += content;
        } catch {}
      }

      // Fallback: maybe it's plain JSON
      if (!fullReply) {
        try {
          const json = JSON.parse(rawText);
          fullReply = json.choices?.[0]?.message?.content || json.choices?.[0]?.delta?.content || "";
        } catch {}
      }

      if (!fullReply) {
        fullReply = "I didn't catch that. Could you say it again?";
      }

      log("AI reply", fullReply.slice(0, 80));
      historyRef.current.push({ role: "assistant", content: fullReply });

      // Speak via server TTS
      if (isActiveRef.current && isSpeakingRef.current) {
        await speakServerAudio(fullReply);
      }
    } catch (err: any) {
      const msg = err?.name === "AbortError" ? "Response timed out" : (err?.message ?? "Voice processing failed");
      log("getResponseAndSpeak error", msg);
      toast({ title: msg, variant: "destructive" });
    }

    // Done speaking → go back to listening
    isSpeakingRef.current = false;
    setAudioLevel(0);
    if (isActiveRef.current && !isMutedRef.current) {
      setTimeout(() => startListeningRef.current(), 300);
    }
  }, [speakServerAudio, stopMicLevelTracking, toast]);

  // ── MediaRecorder-based listening (works on ALL platforms) ──
  const startListening = useCallback(() => {
    if (!isActiveRef.current || isMutedRef.current) return;
    if (!streamRef.current) {
      log("No mic stream, cannot listen");
      return;
    }

    // Barge-in: kill any playing audio
    if (isSpeakingRef.current) {
      stopPlayback();
    }

    // Stop previous recorder
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch {}
    }

    setStatus("listening");
    startMicLevelTracking();
    audioChunksRef.current = [];

    // Pick a mime type the device supports
    const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4"
      : "";
    recorderMimeRef.current = mimeType || "audio/webm";

    const recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    let hasAudio = false;
    let stopped = false;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
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
        log("No audio captured, restarting");
        setTimeout(() => {
          if (isActiveRef.current && !isMutedRef.current && !isSpeakingRef.current) {
            startListening();
          }
        }, 500);
        return;
      }

      const audioBlob = new Blob(audioChunksRef.current, { type: recorderMimeRef.current });
      log("Captured audio", { size: audioBlob.size, mime: recorderMimeRef.current });

      // Minimum size check (very short recordings are likely silence)
      if (audioBlob.size < 1000) {
        log("Audio too short, restarting");
        setTimeout(() => {
          if (isActiveRef.current && !isMutedRef.current && !isSpeakingRef.current) {
            startListening();
          }
        }, 500);
        return;
      }

      try {
        setStatus("connecting");
        const transcript = await transcribeAudio(audioBlob);
        log("Transcript", transcript);

        if (transcript && transcript.trim().length > 1) {
          await getResponseAndSpeak(transcript.trim());
        } else {
          log("Empty transcript, restarting");
          if (isActiveRef.current && !isMutedRef.current && !isSpeakingRef.current) {
            startListening();
          }
        }
      } catch (err: any) {
        log("Transcription error", err?.message);
        if (isActiveRef.current && !isMutedRef.current && !isSpeakingRef.current) {
          setTimeout(() => startListening(), 800);
        }
      }
    };

    recorder.onerror = () => {
      log("Recorder error");
      if (!stopped && isActiveRef.current && !isMutedRef.current) {
        setTimeout(() => startListening(), 800);
      }
    };

    try {
      recorder.start(250); // Collect data every 250ms
      log("Recorder started", recorderMimeRef.current);
    } catch (e) {
      log("Failed to start recorder", e);
      setTimeout(() => {
        if (isActiveRef.current) startListening();
      }, 1000);
      return;
    }

    // Silence cutoff: stop the recorder after the configured silence duration
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      if (recorder.state === "recording") {
        log("Silence cutoff reached");
        try { recorder.stop(); } catch {}
      }
    }, silenceCutoffRef.current);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopPlayback, startMicLevelTracking, stopMicLevelTracking, transcribeAudio, getResponseAndSpeak]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

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

      // Resume AudioContext if suspended (iOS requirement)
      if (audioContextRef.current?.state === "suspended") {
        await audioContextRef.current.resume();
      }

      setIsConnected(true);
      startListening();
    } catch (error) {
      let errorMessage = "Could not access microphone";
      if (error instanceof Error) {
        if (error.name === "NotAllowedError") errorMessage = "Microphone access denied. Check browser settings.";
        else if (error.name === "NotFoundError") errorMessage = "No microphone found on this device.";
        else if (error.name === "NotReadableError") errorMessage = "Microphone is in use by another app.";
      }
      toast({ title: errorMessage, variant: "destructive" });
      setStatus("idle");
    }
  }, [startListening, toast]);

  const endCall = useCallback(() => {
    isActiveRef.current = false;
    clearSilenceTimer();

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch {}
    }
    recorderRef.current = null;

    stopPlayback();
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
  }, [onClose, stopPlayback, stopMicLevelTracking]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    isMutedRef.current = next;

    if (next) {
      clearSilenceTimer();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try { recorderRef.current.stop(); } catch {}
      }
      stopPlayback();
      stopMicLevelTracking();
      setStatus("idle");
    } else if (isConnected) {
      startListening();
    }
  }, [isMuted, isConnected, startListening, stopPlayback, stopMicLevelTracking]);

  useEffect(() => {
    startCall();
    return () => {
      isActiveRef.current = false;
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try { recorderRef.current.stop(); } catch {}
      }
      if (playbackAudioRef.current) {
        try { playbackAudioRef.current.pause(); } catch {}
      }
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusLabel =
    status === "connecting" ? "Processing…" :
    status === "listening" ? "Listening…" :
    status === "speaking" ? "Speaking…" : "Ready";

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
            status === "connecting" ? "text-violet-400" :
            "text-white/40"
          )}>
            {statusLabel}
          </p>
        </div>

        <div className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm p-4 space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>Silence cutoff</span>
              <span className="font-mono">{(silenceCutoff / 1000).toFixed(1)}s</span>
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

        {!isConnected && status !== "connecting" && (
          <Button variant="outline" onClick={startCall} className="w-full border-white/10 text-white hover:bg-white/[0.06]">
            Reconnect
          </Button>
        )}
      </div>
    </motion.div>
  );
};
