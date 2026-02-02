import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PhoneOff, Mic, MicOff, Volume2, Settings, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { VoiceVisualizer } from "./VoiceVisualizer";

interface VoiceCallProps {
  onClose: () => void;
}

// Deepgram Aura voices
const VOICE_OPTIONS = [
  { id: "asteria", name: "Asteria (Feminine)" },
  { id: "luna", name: "Luna (Feminine)" },
  { id: "athena", name: "Athena (Feminine)" },
  { id: "orion", name: "Orion (Masculine)" },
  { id: "zeus", name: "Zeus (Masculine)" },
  { id: "helios", name: "Helios (Masculine)" },
];

export const VoiceCall = ({ onClose }: VoiceCallProps) => {
  const { toast } = useToast();
  const [callStart] = useState(() => Date.now());
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(() => 
    localStorage.getItem("xai-tts-voice") || "asteria"
  );
  const [status, setStatus] = useState<"idle" | "listening" | "processing" | "speaking">("idle");
  const [isConnected, setIsConnected] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

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
    setStatus("speaking");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ text, voiceId: selectedVoice }),
      });

      if (!response.ok) throw new Error("TTS failed");

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        setStatus("listening");
        startListening();
      };

      await audio.play();
    } catch (error) {
      console.error("TTS error:", error);
      toast({ title: "Speech failed", variant: "destructive" });
      setStatus("listening");
      startListening();
    }
  }, [selectedVoice, toast]);

  const processAudio = useCallback(async (audioBlob: Blob) => {
    setStatus("processing");
    try {
      // Convert blob to base64
      const arrayBuffer = await audioBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Audio = btoa(binary);

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      // Send to Deepgram STT
      const sttResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/speech-to-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ audio: base64Audio }),
      });

      if (!sttResponse.ok) throw new Error("STT failed");

      const { transcript } = await sttResponse.json();
      
      if (!transcript || transcript.trim() === "") {
        setStatus("listening");
        startListening();
        return;
      }

      console.log("Transcribed:", transcript);

      // Get AI response
      const chatResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: transcript }],
        }),
      });

      if (!chatResponse.ok) throw new Error("Chat failed");

      // Parse streaming response
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

      if (fullResponse) {
        await speakResponse(fullResponse);
      } else {
        setStatus("listening");
        startListening();
      }
    } catch (error) {
      console.error("Process error:", error);
      toast({ title: "Processing failed", variant: "destructive" });
      setStatus("listening");
      startListening();
    }
  }, [speakResponse, toast]);

  const startListening = useCallback(() => {
    if (!streamRef.current || isMuted) return;

    audioChunksRef.current = [];
    const mediaRecorder = new MediaRecorder(streamRef.current, { mimeType: "audio/webm" });
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      if (audioChunksRef.current.length > 0) {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (audioBlob.size > 1000) { // Only process if there's actual audio
          processAudio(audioBlob);
        } else {
          setStatus("listening");
          startListening();
        }
      }
    };

    mediaRecorder.start();
    setStatus("listening");

    // Auto-stop after 5 seconds of recording
    setTimeout(() => {
      if (mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
    }, 5000);
  }, [isMuted, processAudio]);

  const startCall = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setIsConnected(true);
      toast({ title: "Connected" });

      // Start listening immediately
      startListening();
    } catch (error) {
      console.error("Microphone error:", error);
      toast({ title: "Could not access microphone", variant: "destructive" });
    }
  }, [startListening, toast]);

  const endCall = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    setIsConnected(false);
    setStatus("idle");
    onClose();
  }, [onClose]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    if (next && mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      setStatus("idle");
    } else if (!next && isConnected) {
      startListening();
    }
  }, [isMuted, isConnected, startListening]);

  const saveVoice = () => {
    localStorage.setItem("xai-tts-voice", selectedVoice);
    toast({ title: "Voice saved" });
  };

  useEffect(() => {
    startCall();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusLabel = status === "listening" ? "Listening…" : 
                      status === "processing" ? "Processing…" : 
                      status === "speaking" ? "Speaking…" : "Connecting…";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-6 p-6 sm:p-8 max-w-md w-full">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-1">Voice Call</h2>
          <p className="text-muted-foreground">{formatDuration(callDuration)}</p>
        </div>

        {/* Status indicator */}
        <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-xai-cyan to-xai-purple flex items-center justify-center">
          {status === "speaking" ? (
            <Volume2 className="h-12 w-12 text-white animate-pulse" />
          ) : status === "processing" ? (
            <Loader2 className="h-12 w-12 text-white animate-spin" />
          ) : isConnected ? (
            <Mic className="h-12 w-12 text-white" />
          ) : (
            <MicOff className="h-12 w-12 text-white/50" />
          )}

          <AnimatePresence>
            {status === "listening" && (
              <motion.div
                initial={{ scale: 1, opacity: 0.5 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="absolute inset-0 rounded-full bg-gradient-to-br from-xai-cyan to-xai-purple"
              />
            )}
          </AnimatePresence>
        </div>

        {/* Voice visualizer */}
        {status === "listening" && <VoiceVisualizer isActive={true} className="h-12" />}

        <div className="text-center min-h-[60px]">
          <p className={cn("text-sm", status === "speaking" ? "text-xai-cyan" : "text-muted-foreground")}>
            {statusLabel}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Speak naturally, I'll respond when you pause.
          </p>
        </div>

        {/* Voice selection */}
        <div className="w-full rounded-xl border border-border bg-card/50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Voice</span>
          </div>
          <div className="flex gap-2">
            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              className="flex-1 h-9 rounded-md border border-border bg-background px-3 text-sm outline-none"
            >
              {VOICE_OPTIONS.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.name}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={saveVoice} className="h-9">
              Save
            </Button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4">
          <Button
            variant="secondary"
            size="icon"
            onClick={toggleMute}
            className={cn("h-14 w-14 rounded-full", isMuted && "bg-destructive/20 text-destructive")}
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </Button>

          <Button
            variant="destructive"
            size="icon"
            onClick={endCall}
            className="h-16 w-16 rounded-full"
            aria-label="End call"
          >
            <PhoneOff className="h-7 w-7" />
          </Button>
        </div>

        {!isConnected && (
          <Button variant="xai" onClick={startCall} className="w-full">
            Reconnect
          </Button>
        )}
      </div>
    </motion.div>
  );
};
