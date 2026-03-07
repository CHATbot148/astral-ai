import { motion } from 'framer-motion';
import { Globe, Sparkles } from 'lucide-react';

interface TypingIndicatorProps {
  label?: string;
  mode?: 'typing' | 'search';
}

export const TypingIndicator = ({ label, mode = 'typing' }: TypingIndicatorProps) => {
  const isSearch = mode === 'search';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="w-full px-4 py-4"
    >
      {isSearch ? (
        <div className="flex items-center gap-2 min-w-0 w-full">
          <motion.div
            animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.06, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            className="text-primary flex-shrink-0"
          >
            <Globe className="h-4 w-4" />
          </motion.div>
          <div className="min-w-0 flex-1 text-sm font-medium text-transparent bg-clip-text bg-[linear-gradient(90deg,hsl(var(--muted-foreground))_0%,hsl(var(--foreground))_45%,hsl(var(--muted-foreground))_100%)] bg-[length:220%_100%] animate-[shimmer_1.8s_linear_infinite] whitespace-nowrap truncate">
            {label || 'Searching the web…'}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 min-w-0">
          <motion.div
            className="relative h-5 w-5 flex-shrink-0"
            aria-hidden="true"
            animate={{ rotate: 360 }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
          >
            <div className="absolute inset-0 rounded-full border border-primary/35" />
            <motion.div
              className="absolute inset-[3px] rounded-full bg-primary/80"
              animate={{ scale: [0.7, 1, 0.7], opacity: [0.55, 1, 0.55] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            />
          </motion.div>
          <motion.div
            className="text-sm text-muted-foreground flex items-center gap-1.5"
            animate={{ opacity: [0.65, 1, 0.65] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary/80" />
            <span>{label || 'Astraz is thinking…'}</span>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
};
