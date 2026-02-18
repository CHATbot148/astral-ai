import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2, Pause, Play, RotateCcw, RotateCw, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cleanTextForTTS } from "@/utils/cleanTextForTTS";
interface AudioPlayerProps {
  text: string;
  onClose: () => void;
}

export const AudioPlayer = ({ text, onClose }: AudioPlayerProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (audioRef.current) audioRef.current.pause();
    };
  }, [audioUrl]);

  const generateAudio = async () => {
    setIsLoading(true);

    // Deepgram voices: asteria, luna, athena (feminine), orion, zeus, helios (masculine)
    const voiceId = localStorage.getItem("xai-tts-voice") || "asteria";

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      // Clean text before sending to TTS - remove emojis, links, markdown, code blocks
      const cleanedText = cleanTextForTTS(text);
      if (!cleanedText) {
        setIsLoading(false);
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ text: cleanedText, voiceId }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(errText || `TTS request failed (${response.status})`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("audio")) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json?.error || "TTS did not return audio");
      }

      const audioBlob = await response.blob();
      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
      audio.addEventListener("timeupdate", () => setProgress((audio.currentTime / audio.duration) * 100));
      audio.addEventListener("ended", () => {
        setIsPlaying(false);
        setProgress(0);
      });

      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      // Suppress benign abort/pause errors that happen during normal operation
      const msg = err instanceof Error ? err.message : String(err);
      console.error("TTS error:", msg);
      // Never show errors in the player UI — only in toasts for critical failures
      // Most TTS errors are benign (abort, permission, large payload) and audio still works
      toast({ title: "Text-to-speech failed", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const skip = (seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(
      0,
      Math.min(audioRef.current.duration, audioRef.current.currentTime + seconds)
    );
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const currentTime = audioRef.current?.currentTime || (duration * progress) / 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-secondary border border-border max-w-full overflow-hidden"
    >
      {!audioUrl && !isLoading && (
        <Button variant="ghost" size="sm" onClick={generateAudio} className="gap-2 text-xai-cyan hover:text-xai-cyan">
          <Volume2 className="h-4 w-4" />
          Listen
        </Button>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 px-2">
          <Loader2 className="h-4 w-4 animate-spin text-xai-cyan flex-shrink-0" />
          <span className="text-sm text-muted-foreground truncate">Generating…</span>
        </div>
      )}

      {audioUrl && !isLoading && (
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => skip(-10)}
            className="p-1 rounded-full hover:bg-background transition-colors flex-shrink-0"
            aria-label="Back 10 seconds"
          >
            <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={togglePlayPause}
            className="p-1.5 rounded-full bg-xai-cyan text-background flex-shrink-0"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => skip(10)}
            className="p-1 rounded-full hover:bg-background transition-colors flex-shrink-0"
            aria-label="Forward 10 seconds"
          >
            <RotateCw className="h-3.5 w-3.5 text-muted-foreground" />
          </motion.button>

          <div className="flex-1 min-w-[60px] mx-1">
            <div className="relative h-1 bg-background rounded-full overflow-hidden">
              <motion.div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-xai-cyan to-xai-purple rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
            {formatTime(currentTime)}/{formatTime(duration)}
          </span>
        </div>
      )}

      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => {
          if (audioRef.current) audioRef.current.pause();
          onClose();
        }}
        className="p-1 rounded-full hover:bg-background transition-colors flex-shrink-0"
        aria-label="Close"
      >
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </motion.button>
    </motion.div>
  );
};
