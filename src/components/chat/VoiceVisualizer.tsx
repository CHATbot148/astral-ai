import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface VoiceVisualizerProps {
  isActive: boolean;
  /** Optional bar levels in [0..1]. If omitted we fall back to a subtle idle animation. */
  levels?: number[];
  className?: string;
}

export const VoiceVisualizer = ({ isActive, levels, className }: VoiceVisualizerProps) => {
  const bars = levels?.length ?? 12;

  return (
    <div className={cn('flex items-center justify-center gap-0.5 h-8', className)}>
      {Array.from({ length: bars }).map((_, i) => {
        const level = levels?.[i] ?? 0.15;
        const px = 4 + level * 22;

        return (
          <motion.div
            key={i}
            className="w-1 rounded-full bg-gradient-to-t from-xai-cyan to-xai-purple"
            initial={{ height: 4 }}
            animate={
              isActive
                ? { height: px }
                : { height: [4, 6, 4] }
            }
            transition={
              isActive
                ? { duration: 0.08, ease: 'linear' }
                : { duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.03 }
            }
          />
        );
      })}
    </div>
  );
};
