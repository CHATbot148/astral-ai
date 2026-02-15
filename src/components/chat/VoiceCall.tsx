import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PhoneOff, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { VoiceOrb } from "./VoiceOrb";

interface VoiceCallProps {
  onClose: () => void;
}

// Deepgram Aura voices - 8 feminine, 8 masculine
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

export const VoiceCall = ({ onClose }: VoiceCallProps) => {
  const { toast } = useToast();
  const [callStart] = useState(() => Date.now());
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(() =>
    localStorage.getItem("xai-tts-voice") || "asteria"
  );
  const [status, setStatus] = useState<"idle" | "connecting" | "listening" | "processing" | "speaking">("idle");
  const [isConnected, setIsConnected] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const isActiveRef = useRef(true);
  const selectedVoiceRef = useRef(selectedVoice);
  const isMutedRef = useRef(isMuted);
  // Pre-unlocked audio element for iOS
  const preUnlockedAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { selectedVoiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  useEffect(() => {
    const t = setInterval(() => setCallDuration(Math.floor((Date.now() - callStart) / 1000)), 1000);
    return () => clearInterval(t);
  }, [callStart]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const speakResponse = useCallback(async (text: string) => {
    if (!isActiveRef.current) return;
    setStatus("speaking");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const voiceId = selectedVoiceRef.current;

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ text, voiceId }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(errorText || "TTS failed");
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("audio")) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json?.error || "TTS did not return audio");
      }

      if (!isActiveRef.current) return;

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Use pre-unlocked audio element on iOS, or create new one
      const audio = preUnlockedAudioRef.current || new Audio();
      audio.src = audioUrl;
      currentAudioRef.current = audio;
      audio.setAttribute("playsinline", "true");

      // Monitor for user interruption while AI speaks
      const startListeningForInterrupt = () => {
        if (!streamRef.current || !isActiveRef.current || isMutedRef.current) return;
        try {
          const interruptCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const interruptSource = interruptCtx.createMediaStreamSource(streamRef.current!);
          const interruptAnalyser = interruptCtx.createAnalyser();
          interruptAnalyser.fftSize = 512;
          interruptSource.connect(interruptAnalyser);
          const interruptData = new Uint8Array(interruptAnalyser.frequencyBinCount);
          let speechFrames = 0;

          const checkInterrupt = () => {
            if (!audio || audio.paused || audio.ended || !isActiveRef.current) {
              interruptCtx.close().catch(() => {});
              return;
            }
            interruptAnalyser.getByteFrequencyData(interruptData);
            const avg = interruptData.reduce((s, v) => s + v, 0) / interruptData.length;
            if (avg > 25) {
              speechFrames++;
              if (speechFrames > 8) {
                audio.pause();
                audio.src = "";
                interruptCtx.close().catch(() => {});
                URL.revokeObjectURL(audioUrl);
                // After interruption, go back to listening for user's next input
                if (isActiveRef.current && !isMutedRef.current) {
                  setStatus("listening");
                  startListening();
                }
                return;
              }
            } else {
              speechFrames = Math.max(0, speechFrames - 1);
            }
            requestAnimationFrame(checkInterrupt);
          };
          requestAnimationFrame(checkInterrupt);
        } catch (e) {
          console.error("Interrupt monitor error:", e);
        }
      };

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          currentAudioRef.current = null;
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          currentAudioRef.current = null;
          reject(new Error("Audio playback error"));
        };

        const playPromise = audio.play();
        if (playPromise) {
          playPromise.then(() => {
            startListeningForInterrupt();
          }).catch((err) => {
            if (err.name === "AbortError") {
              resolve();
            } else {
              // iOS autoplay blocked — try with user interaction context
              console.warn("Audio play blocked:", err.message);
              resolve();
            }
          });
        }
      });

      // After speaking finishes normally, go back to listening
      if (isActiveRef.current && !isMutedRef.current) {
        setStatus("listening");
        startListening();
      } else {
        setStatus("idle");
      }
    } catch (error) {
      console.error("TTS error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.toLowerCase().includes("abort")) {
        toast({ title: "Speech failed", variant: "destructive" });
      }
      if (isActiveRef.current && !isMutedRef.current) {
        setStatus("listening");
        startListening();
      }
    }
  }, [toast]);

  const processAudio = useCallback(async (audioBlob: Blob) => {
    if (!isActiveRef.current) return;
    setStatus("processing");

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Audio = btoa(binary);

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      // STT
      const sttResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/speech-to-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ audio: base64Audio }),
      });

      if (!sttResponse.ok) {
        const errText = await sttResponse.text().catch(() => "");
        throw new Error(errText || "STT failed");
      }

      const { transcript, error: sttError } = await sttResponse.json();
      if (sttError) throw new Error(sttError);

      if (!transcript || transcript.trim() === "") {
        if (isActiveRef.current && !isMutedRef.current) {
          setStatus("listening");
          startListening();
        }
        return;
      }

      console.log("Transcribed:", transcript);

      // Chat — collect full response then speak
      const chatResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: transcript }],
          isVoiceMode: true,
        }),
      });

      if (!chatResponse.ok) throw new Error("Chat failed");

      const reader = chatResponse.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!isActiveRef.current) { reader.cancel(); return; }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const json = JSON.parse(line.slice(6));
              const content = json.choices?.[0]?.delta?.content;
              if (content) fullResponse += content;
            } catch {}
          }
        }
      }

      if (fullResponse && isActiveRef.current) {
        await speakResponse(fullResponse);
      } else if (isActiveRef.current && !isMutedRef.current) {
        setStatus("listening");
        startListening();
      }
    } catch (error) {
      console.error("Process error:", error);
      toast({ title: "Processing failed", variant: "destructive" });
      if (isActiveRef.current && !isMutedRef.current) {
        setStatus("listening");
        startListening();
      }
    }
  }, [speakResponse, toast]);

  const startListening = useCallback(() => {
    if (!streamRef.current || isMutedRef.current || !isActiveRef.current) return;

    audioChunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";

    const options = mimeType ? { mimeType } : undefined;

    try {
      const mediaRecorder = new MediaRecorder(streamRef.current, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (audioChunksRef.current.length > 0 && isActiveRef.current) {
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType || "audio/webm" });
          if (audioBlob.size > 1000) {
            processAudio(audioBlob);
          } else if (isActiveRef.current && !isMutedRef.current) {
            setStatus("listening");
            startListening();
          }
        }
      };

      mediaRecorder.onerror = (e) => {
        console.error("MediaRecorder error:", e);
        if (isActiveRef.current && !isMutedRef.current) {
          setTimeout(() => startListening(), 500);
        }
      };

      mediaRecorder.start();
      setStatus("listening");

      // Silence detection via AudioContext
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(streamRef.current!);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      let silenceStart: number | null = null;
      const SILENCE_THRESHOLD = 15;
      const SILENCE_DURATION = 1800;
      const MAX_RECORD_TIME = 30000;
      const recordStart = Date.now();

      const checkSilence = () => {
        if (mediaRecorder.state !== "recording" || !isActiveRef.current) {
          audioContext.close().catch(() => {});
          return;
        }

        if (Date.now() - recordStart > MAX_RECORD_TIME) {
          mediaRecorder.stop();
          audioContext.close().catch(() => {});
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;

        if (avg < SILENCE_THRESHOLD) {
          if (!silenceStart) silenceStart = Date.now();
          else if (Date.now() - silenceStart > SILENCE_DURATION) {
            mediaRecorder.stop();
            audioContext.close().catch(() => {});
            return;
          }
        } else {
          silenceStart = null;
        }

        requestAnimationFrame(checkSilence);
      };

      requestAnimationFrame(checkSilence);
    } catch (error) {
      console.error("MediaRecorder error:", error);
      toast({ title: "Recording failed", variant: "destructive" });
    }
  }, [processAudio, toast]);

  const startCall = useCallback(async () => {
    setStatus("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      streamRef.current = stream;
      isActiveRef.current = true;
      setIsConnected(true);

      // Pre-unlock audio for iOS — must happen during user gesture
      try {
        const audio = new Audio();
        audio.setAttribute("playsinline", "true");
        // Play a tiny silent audio to unlock the audio element
        audio.src = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwVHAAAAAAD/+1DEAAAHAAGf9AAAIgAANIAAAAQAAAE/////ygfB8HwfB8AAAAB8Hw+D4Pg+D4Pg+H///8HwfB8HwfB8HwfB8H///4Pg+D4Pg+D4Pg+D4f///B8HwfB8HwfB8HwfD///+D4Pg+D4Pg+D4Pg//tQxBWAAADSAAAAAAAAANIAAAAQ+H///wfB8HwfB8HwfB8Hw///+D4Pg+D4Pg+D4Pg+H///B8HwfB8HwfB8HwfB8P//+D4Pg+D4Pg+D4Pg+D4f//B8HwfB8HwfB8HwfB8Hw//8=";
        await audio.play().catch(() => {});
        audio.pause();
        preUnlockedAudioRef.current = audio;
      } catch (e) {
        console.warn("Audio pre-unlock failed:", e);
      }

      // Also pre-unlock AudioContext for iOS
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (ctx.state === "suspended") await ctx.resume();
        ctx.close().catch(() => {});
      } catch (e) {
        console.warn("AudioContext pre-unlock failed:", e);
      }

      // Start listening immediately (no delay)
      startListening();
    } catch (error) {
      console.error("Microphone error:", error);

      let errorMessage = "Could not access microphone";
      if (error instanceof Error) {
        if (error.name === "NotAllowedError") {
          errorMessage = "Microphone access denied. Please allow microphone access in your browser settings.";
        } else if (error.name === "NotFoundError") {
          errorMessage = "No microphone found on this device.";
        } else if (error.name === "NotReadableError") {
          errorMessage = "Microphone is already in use by another application.";
        }
      }

      toast({ title: errorMessage, variant: "destructive" });
      setStatus("idle");
    }
  }, [startListening, toast]);

  const endCall = useCallback(() => {
    isActiveRef.current = false;

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setIsConnected(false);
    setStatus("idle");
    onClose();
  }, [onClose]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    isMutedRef.current = next;

    if (next) {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
      }
      setStatus("idle");
    } else if (isConnected) {
      startListening();
    }
  }, [isMuted, isConnected, startListening]);

  useEffect(() => {
    startCall();

    return () => {
      isActiveRef.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusLabel =
    status === "connecting" ? "Connecting…" :
    status === "listening" ? "Listening…" :
    status === "processing" ? "Thinking…" :
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
        {/* Timer */}
        <div className="text-center">
          <p className="text-white/50 text-sm font-mono tracking-widest">{formatDuration(callDuration)}</p>
        </div>

        {/* Central Orb */}
        <div className="flex-1 flex items-center justify-center">
          <VoiceOrb status={status} isMuted={isMuted} />
        </div>

        {/* Status */}
        <div className="text-center mb-2">
          <p className={cn(
            "text-sm font-medium tracking-wide transition-colors",
            status === "speaking" ? "text-cyan-400" :
            status === "listening" ? "text-emerald-400" :
            status === "processing" ? "text-purple-400" :
            "text-white/40"
          )}>
            {statusLabel}
          </p>
        </div>

        {/* Voice selection */}
        <div className="w-full rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-3">
          <select
            value={selectedVoice}
            onChange={(e) => {
              const newVoice = e.target.value;
              setSelectedVoice(newVoice);
              selectedVoiceRef.current = newVoice;
              localStorage.setItem("xai-tts-voice", newVoice);
            }}
            className="w-full h-9 rounded-md border border-white/10 bg-black/50 px-3 text-sm text-white outline-none"
          >
            <optgroup label="Feminine Voices">
              {feminineVoices.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </optgroup>
            <optgroup label="Masculine Voices">
              {masculineVoices.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Controls */}
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
