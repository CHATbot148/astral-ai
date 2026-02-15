import { motion } from 'framer-motion';
import xaiLogo from '@/assets/xai-logo.png';

export const TypingIndicator = ({ label }: { label?: string }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex gap-3 px-4 py-4 max-w-full overflow-hidden"
    >
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-xai-cyan to-xai-purple flex-shrink-0">
        <img src={xaiLogo} alt="X-AI" className="w-full h-full object-cover" />
      </div>

      <div className="flex flex-col justify-center min-w-0">
        {/* Typing Dots */}
        <div className="flex items-center gap-1.5 py-1">
          {[0, 0.15, 0.3].map((delay, i) => (
            <motion.span
              key={i}
              className="w-2 h-2 rounded-full bg-xai-cyan flex-shrink-0"
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }}
              transition={{ duration: 1.2, repeat: Infinity, delay }}
            />
          ))}
        </div>

        {label && <div className="text-xs text-muted-foreground truncate">{label}</div>}
      </div>
    </motion.div>
  );
};
