import { motion } from 'framer-motion';
import xaiLogo from '@/assets/xai-logo.png';

export const TypingIndicator = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex gap-4 px-4 py-6 bg-muted/30"
    >
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-xai-cyan to-xai-purple xai-glow flex-shrink-0">
        <img src={xaiLogo} alt="X-AI" className="w-full h-full object-cover" />
      </div>

      {/* Typing Dots */}
      <div className="flex items-center gap-1 py-2">
        <motion.span
          className="w-2 h-2 rounded-full bg-xai-cyan"
          animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1, 0.8] }}
          transition={{ duration: 1, repeat: Infinity, delay: 0 }}
        />
        <motion.span
          className="w-2 h-2 rounded-full bg-xai-cyan"
          animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1, 0.8] }}
          transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
        />
        <motion.span
          className="w-2 h-2 rounded-full bg-xai-cyan"
          animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1, 0.8] }}
          transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
        />
      </div>
    </motion.div>
  );
};
