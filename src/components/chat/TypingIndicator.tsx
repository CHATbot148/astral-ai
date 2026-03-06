import { motion } from 'framer-motion';
import { Globe } from 'lucide-react';

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
      className="flex gap-3 px-4 py-4 max-w-full overflow-hidden"
    >
      <div className="flex flex-col justify-center min-w-0">
        {isSearch ? (
          <div className="flex items-center gap-2 min-w-0">
            <motion.div
              animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.05, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              className="text-primary"
            >
              <Globe className="h-4 w-4" />
            </motion.div>
            <div className="text-sm font-medium text-transparent bg-clip-text bg-[linear-gradient(90deg,hsl(var(--muted-foreground))_0%,hsl(var(--foreground))_45%,hsl(var(--muted-foreground))_100%)] bg-[length:220%_100%] animate-[shimmer_1.8s_linear_infinite] truncate">
              {label || 'Searching the web…'}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 py-1">
              {[0, 0.15, 0.3].map((delay, i) => (
                <motion.span
                  key={i}
                  className="w-2 h-2 rounded-full bg-primary flex-shrink-0"
                  animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay }}
                />
              ))}
            </div>
            {label && <div className="text-xs text-muted-foreground truncate">{label}</div>}
          </>
        )}
      </div>
    </motion.div>
  );
};
