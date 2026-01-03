import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Volume2, Pause, Play, RotateCcw, RotateCw, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const generateAudio = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ text }),
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to generate audio");
      }

      const audioBlob = await response.blob();
      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);

      // Create and play audio
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.addEventListener('loadedmetadata', () => {
        setDuration(audio.duration);
      });

      audio.addEventListener('timeupdate', () => {
        setProgress((audio.currentTime / audio.duration) * 100);
      });

      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        setProgress(0);
      });

      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate audio");
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
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const currentTime = audioRef.current?.currentTime || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary border border-border"
    >
      {!audioUrl && !isLoading && (
        <Button
          variant="ghost"
          size="sm"
          onClick={generateAudio}
          className="gap-2 text-xai-cyan hover:text-xai-cyan"
        >
          <Volume2 className="h-4 w-4" />
          Listen
        </Button>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 px-2">
          <Loader2 className="h-4 w-4 animate-spin text-xai-cyan" />
          <span className="text-sm text-muted-foreground">Generating audio...</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-2 text-destructive text-sm">
          {error}
        </div>
      )}

      {audioUrl && !isLoading && (
        <>
          {/* Rewind 10s */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => skip(-10)}
            className="p-1.5 rounded-full hover:bg-background transition-colors"
          >
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
          </motion.button>

          {/* Play/Pause */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={togglePlayPause}
            className="p-2 rounded-full bg-xai-cyan text-background"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 ml-0.5" />
            )}
          </motion.button>

          {/* Forward 10s */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => skip(10)}
            className="p-1.5 rounded-full hover:bg-background transition-colors"
          >
            <RotateCw className="h-4 w-4 text-muted-foreground" />
          </motion.button>

          {/* Progress bar */}
          <div className="flex-1 min-w-[100px] mx-2">
            <div className="relative h-1.5 bg-background rounded-full overflow-hidden">
              <motion.div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-xai-cyan to-xai-purple rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Time */}
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </>
      )}

      {/* Close button */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={onClose}
        className="p-1 rounded-full hover:bg-background transition-colors ml-1"
      >
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </motion.button>
    </motion.div>
  );
};
