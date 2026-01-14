import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Volume2, Pause, Play, RotateCcw, RotateCw, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

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
  const [useBrowserSynthesis, setUseBrowserSynthesis] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      // Cancel any browser speech
      speechSynthesis.cancel();
    };
  }, [audioUrl]);

  const generateAudio = async () => {
    setIsLoading(true);
    setError(null);

    // Get selected voice from localStorage
    const voiceId = localStorage.getItem('xai-tts-voice') || 'george';

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
          body: JSON.stringify({ text, voiceId }),
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to generate audio");
      }

      // Check content type to determine if it's audio or JSON
      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        // Server returned JSON - use browser synthesis
        const data = await response.json();
        if (data.useBrowserSynthesis) {
          setUseBrowserSynthesis(true);
          playWithBrowserSynthesis(data.text, data.voice);
          return;
        }
      }

      // It's audio data
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
      console.error('TTS error:', err);
      // Fallback to browser synthesis on any error
      setUseBrowserSynthesis(true);
      playWithBrowserSynthesis(text, { name: 'george', lang: 'en-US', pitch: 1.0, rate: 1.0 });
    } finally {
      setIsLoading(false);
    }
  };

  const playWithBrowserSynthesis = async (textToSpeak: string, voiceConfig: { name: string; lang: string; pitch: number; rate: number }) => {
    try {
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      
      // Get available voices
      let voices = speechSynthesis.getVoices();
      if (voices.length === 0) {
        await new Promise(resolve => {
          speechSynthesis.onvoiceschanged = resolve;
          setTimeout(resolve, 500);
        });
        voices = speechSynthesis.getVoices();
      }

      // Voice character mapping
      const voiceMapping: Record<string, { gender: string; lang: string }> = {
        'george': { gender: 'male', lang: 'en-GB' },
        'sarah': { gender: 'female', lang: 'en-US' },
        'laura': { gender: 'female', lang: 'en-US' },
        'liam': { gender: 'male', lang: 'en-US' },
        'lily': { gender: 'female', lang: 'en-GB' },
        'daniel': { gender: 'male', lang: 'en-GB' },
        'roger': { gender: 'male', lang: 'en-US' },
        'alice': { gender: 'female', lang: 'en-GB' },
        'charlie': { gender: 'male', lang: 'en-AU' },
      };

      const config = voiceMapping[voiceConfig.name] || voiceMapping['george'];
      
      // Find a matching voice
      const matchingVoice = voices.find(v => 
        v.lang.startsWith(config.lang.split('-')[0])
      ) || voices.find(v => v.lang.startsWith('en')) || voices[0];

      if (matchingVoice) {
        utterance.voice = matchingVoice;
      }

      utterance.rate = voiceConfig.rate || 1;
      utterance.pitch = config.gender === 'female' ? 1.1 : 0.95;

      // Estimate duration (rough approximation)
      const wordsPerMinute = 150;
      const wordCount = textToSpeak.split(/\s+/).length;
      const estimatedDuration = (wordCount / wordsPerMinute) * 60;
      setDuration(estimatedDuration);

      let startTime = Date.now();
      
      const updateProgress = () => {
        if (!isPlaying) return;
        const elapsed = (Date.now() - startTime) / 1000;
        const percent = Math.min((elapsed / estimatedDuration) * 100, 100);
        setProgress(percent);
        if (percent < 100) {
          requestAnimationFrame(updateProgress);
        }
      };

      utterance.onstart = () => {
        startTime = Date.now();
        setIsPlaying(true);
        requestAnimationFrame(updateProgress);
      };

      utterance.onend = () => {
        setIsPlaying(false);
        setProgress(100);
        setTimeout(() => setProgress(0), 500);
      };

      utterance.onerror = (e) => {
        console.error('Speech synthesis error:', e);
        setError('Speech synthesis failed');
        setIsPlaying(false);
      };

      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
      setIsLoading(false);
    } catch (e) {
      console.error('Browser synthesis error:', e);
      setError('Text-to-speech is not supported in this browser');
      setIsLoading(false);
    }
  };

  const togglePlayPause = () => {
    if (useBrowserSynthesis) {
      if (isPlaying) {
        speechSynthesis.pause();
        setIsPlaying(false);
      } else {
        speechSynthesis.resume();
        setIsPlaying(true);
      }
      return;
    }

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

  const currentTime = audioRef.current?.currentTime || (duration * progress / 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-secondary border border-border max-w-full overflow-hidden"
    >
      {!audioUrl && !isLoading && !error && !useBrowserSynthesis && (
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
          <Loader2 className="h-4 w-4 animate-spin text-xai-cyan flex-shrink-0" />
          <span className="text-sm text-muted-foreground truncate">Generating...</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-2 text-destructive text-xs truncate max-w-[200px]">
          {error}
        </div>
      )}

      {(audioUrl || useBrowserSynthesis) && !isLoading && (
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {/* Rewind 10s (only for audio, not browser synthesis) */}
          {!useBrowserSynthesis && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => skip(-10)}
              className="p-1 rounded-full hover:bg-background transition-colors flex-shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
            </motion.button>
          )}

          {/* Play/Pause */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={togglePlayPause}
            className="p-1.5 rounded-full bg-xai-cyan text-background flex-shrink-0"
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5 ml-0.5" />
            )}
          </motion.button>

          {/* Forward 10s (only for audio, not browser synthesis) */}
          {!useBrowserSynthesis && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => skip(10)}
              className="p-1 rounded-full hover:bg-background transition-colors flex-shrink-0"
            >
              <RotateCw className="h-3.5 w-3.5 text-muted-foreground" />
            </motion.button>
          )}

          {/* Progress bar */}
          <div className="flex-1 min-w-[60px] mx-1">
            <div className="relative h-1 bg-background rounded-full overflow-hidden">
              <motion.div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-xai-cyan to-xai-purple rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Time */}
          <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
            {formatTime(currentTime)}/{formatTime(duration)}
          </span>
        </div>
      )}

      {/* Close button */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => {
          speechSynthesis.cancel();
          onClose();
        }}
        className="p-1 rounded-full hover:bg-background transition-colors flex-shrink-0"
      >
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </motion.button>
    </motion.div>
  );
};