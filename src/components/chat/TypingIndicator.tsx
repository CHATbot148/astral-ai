import { motion } from 'framer-motion';

export const TypingIndicator = ({ label }: { label?: string }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex gap-3 px-4 py-4 max-w-full overflow-hidden"
    >
      <div className="flex flex-col justify-center min-w-0">
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
