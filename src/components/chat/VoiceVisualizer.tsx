import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface VoiceVisualizerProps {
  isActive: boolean;
  className?: string;
}

export const VoiceVisualizer = ({ isActive, className }: VoiceVisualizerProps) => {
  const bars = 12;
  
  return (
    <div className={cn("flex items-center justify-center gap-0.5 h-8", className)}>
      {Array.from({ length: bars }).map((_, i) => (
        <motion.div
          key={i}
          className="w-1 rounded-full bg-gradient-to-t from-xai-cyan to-xai-purple"
          initial={{ height: 4 }}
          animate={
            isActive
              ? {
                  height: [4, 8 + Math.random() * 20, 4, 12 + Math.random() * 16, 4],
                }
              : { height: 4 }
          }
          transition={
            isActive
              ? {
                  duration: 0.5 + Math.random() * 0.3,
                  repeat: Infinity,
                  delay: i * 0.05,
                  ease: "easeInOut",
                }
              : { duration: 0.2 }
          }
        />
      ))}
    </div>
  );
};
