import { motion } from 'framer-motion';
import { Globe, Sparkles } from 'lucide-react';
import { BRAND_ICON } from '@/components/icons/BrandIcons';

interface TypingIndicatorProps {
  label?: string;
  mode?: 'typing' | 'search';
}

const labelToProvider = (label: string): keyof typeof BRAND_ICON | null => {
  const l = label.toLowerCase();
  if (l.includes('gmail')) return 'gmail';
  if (l.includes('google calendar') || l.includes('calendar')) return 'google_calendar';
  if (l.includes('google maps') || l.includes('maps')) return 'google_maps';
  if (l.includes('telegram')) return 'telegram';
  if (l.includes('tiktok')) return 'tiktok';
  return null;
};

export const TypingIndicator = ({ label, mode = 'typing' }: TypingIndicatorProps) => {
  const isSearch = mode === 'search';
  const provider = label ? labelToProvider(label) : null;
  const BrandIcon = provider ? BRAND_ICON[provider] : null;

  return (
    <div className="w-full px-4 py-3 chat-message-enter">
      {isSearch ? (
        <div className="flex items-center gap-2.5 min-w-0 w-full">
          <motion.div
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            className="flex-shrink-0"
          >
            {BrandIcon ? <BrandIcon className="h-4.5 w-4.5" /> : <Globe className="h-4 w-4 text-accent" />}
          </motion.div>
          <div className="min-w-0 flex-1 text-sm font-medium leading-5 text-transparent bg-clip-text bg-[linear-gradient(90deg,hsl(var(--muted-foreground))_0%,hsl(var(--foreground))_45%,hsl(var(--muted-foreground))_100%)] bg-[length:220%_100%] animate-[shimmer_1.4s_linear_infinite] whitespace-normal break-words [overflow-wrap:anywhere]">
            {label || 'Searching the web…'}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-primary"
                animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
              />
            ))}
          </div>
          <span className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary/70" />
            {label || 'Astraz is thinking…'}
          </span>
        </div>
      )}
    </div>
  );
};
