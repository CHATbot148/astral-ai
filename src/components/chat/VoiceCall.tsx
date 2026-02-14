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
  // Feminine voices
  { id: "asteria", name: "Asteria", gender: "feminine" },
  { id: "luna", name: "Luna", gender: "feminine" },
  { id: "athena", name: "Athena", gender: "feminine" },
  { id: "hera", name: "Hera", gender: "feminine" },
  { id: "stella", name: "Stella", gender: "feminine" },
  { id: "aurora", name: "Aurora", gender: "feminine" },
  { id: "thalia", name: "Thalia", gender: "feminine" },
  { id: "cordelia", name: "Cordelia", gender: "feminine" },
  // Masculine voices
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

  // Keep voice ref in sync
  useEffect(() => {
    selectedVoiceRef.current = selectedVoice;
  }, [selectedVoice]);

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
      // Always read from ref for latest voice
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
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;

      // iOS requires these attributes
      audio.setAttribute("playsinline", "true");

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          reject(new Error("Audio playback error"));
        };

        // Use play() with promise handling for iOS
        const playPromise = audio.play();
        if (playPromise) {
          playPromise.catch((err) => {
            // On iOS, AbortError means the play was interrupted - not a real error
            if (err.name === "AbortError") {
              resolve();
            } else {
              reject(err);
            }
          });
        }
      });

      if (isActiveRef.current && !isMuted) {
        setStatus("listening");
        startListening();
      } else {
        setStatus("idle");
      }
    } catch (error) {
      console.error("TTS error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      // Don't show toast for abort errors
      if (!msg.toLowerCase().includes("abort")) {
        toast({ title: "Speech failed", variant: "destructive" });
      }
      if (isActiveRef.current && !isMuted) {
        setStatus("listening");
        startListening();
      }
    }
  }, [toast, isMuted]);

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
        if (isActiveRef.current && !isMuted) {
          setStatus("listening");
          startListening();
        }
        return;
      }

      console.log("Transcribed:", transcript);

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
      } else if (isActiveRef.current && !isMuted) {
        setStatus("listening");
        startListening();
      }
    } catch (error) {
      console.error("Process error:", error);
      toast({ title: "Processing failed", variant: "destructive" });
      if (isActiveRef.current && !isMuted) {
        setStatus("listening");
        startListening();
      }
    }
  }, [speakResponse, toast, isMuted]);

  const startListening = useCallback(() => {
    if (!streamRef.current || isMuted || !isActiveRef.current) return;

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
          } else if (isActiveRef.current && !isMuted) {
            setStatus("listening");
            startListening();
          }
        }
      };

      mediaRecorder.onerror = (e) => {
        console.error("MediaRecorder error:", e);
        if (isActiveRef.current && !isMuted) {
          setTimeout(() => startListening(), 500);
        }
      };

      mediaRecorder.start();
      setStatus("listening");

      setTimeout(() => {
        if (mediaRecorder.state === "recording") {
          mediaRecorder.stop();
        }
      }, 5000);
    } catch (error) {
      console.error("MediaRecorder error:", error);
      toast({ title: "Recording failed", variant: "destructive" });
    }
  }, [isMuted, processAudio, toast]);

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

      setTimeout(() => {
        if (isActiveRef.current) {
          startListening();
        }
      }, 100);
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
