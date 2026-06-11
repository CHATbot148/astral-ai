import { useState, useRef, useEffect } from 'react';
import { Play, Pause, Loader2, Volume2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

type Accent = 'us' | 'uk';

interface PronounceCardProps {
  phrase: string;
}

export const PronounceCard = ({ phrase }: PronounceCardProps) => {
  const cleaned = phrase.trim().replace(/^["'`]+|["'`]+$/g, '');
  const [accent, setAccent] = useState<Accent>('us');
  const [showAccent, setShowAccent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [autoPlayed, setAutoPlayed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const cacheRef = useRef<Record<Accent, string | null>>({ us: null, uk: null });

  const fetchAudio = async (acc: Accent): Promise<string | null> => {
    if (cacheRef.current[acc]) return cacheRef.current[acc];
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) return null;

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: cleaned, accent: acc }),
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      cacheRef.current[acc] = objUrl;
      return objUrl;
    } catch {
      return null;
    }
  };

  const play = async (acc: Accent = accent) => {
    if (loading) return;
    setLoading(true);
    const src = await fetchAudio(acc);
    setLoading(false);
    if (!src) return;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(src);
    audioRef.current = audio;
    urlRef.current = src;
    audio.onended = () => setPlaying(false);
    audio.onpause = () => setPlaying(false);
    audio.onplay = () => setPlaying(true);
    try {
      await audio.play();
    } catch {
      setPlaying(false);
    }
  };

  // Auto-play once on mount
  useEffect(() => {
    if (!autoPlayed && cleaned.length > 0) {
      setAutoPlayed(true);
      play('us');
    }
    return () => {
      if (audioRef.current) audioRef.current.pause();
      Object.values(cacheRef.current).forEach((u) => u && URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggle = () => {
    if (playing && audioRef.current) {
      audioRef.current.pause();
      return;
    }
    play(accent);
  };

  const pickAccent = (a: Accent) => {
    setAccent(a);
    setShowAccent(false);
    play(a);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 inline-flex items-center gap-3 px-4 py-3 rounded-2xl border border-border bg-gradient-to-br from-secondary/60 to-secondary/30 backdrop-blur-md shadow-sm max-w-full"
    >
      <button
        type="button"
        onClick={handleToggle}
        disabled={loading}
        className={cn(
          'flex-shrink-0 h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center transition-all hover:scale-105 active:scale-95',
          loading && 'opacity-70'
        )}
        aria-label={playing ? 'Pause' : 'Play pronunciation'}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4 ml-0.5" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={() => setShowAccent((v) => !v)}
          className="text-left text-foreground font-semibold text-base leading-tight break-words hover:underline decoration-dotted underline-offset-4"
          title="Tap to choose accent"
        >
          {cleaned}
        </button>
        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
          <Volume2 className="h-3 w-3" />
          <span>{accent === 'us' ? 'American' : 'British'} • tap word to change</span>
        </div>

        <AnimatePresence>
          {showAccent && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="mt-2 flex gap-1.5"
            >
              <button
                type="button"
                onClick={() => pickAccent('us')}
                className={cn(
                  'text-xs px-3 py-1 rounded-full border transition-colors',
                  accent === 'us'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background/60 border-border hover:bg-secondary'
                )}
              >
                🇺🇸 American
              </button>
              <button
                type="button"
                onClick={() => pickAccent('uk')}
                className={cn(
                  'text-xs px-3 py-1 rounded-full border transition-colors',
                  accent === 'uk'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background/60 border-border hover:bg-secondary'
                )}
              >
                🇬🇧 British
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
