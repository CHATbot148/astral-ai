import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import astrazLogo from '@/assets/astraz-logo.png';

interface SplashScreenProps {
  onComplete: () => void;
}

export const SplashScreen = ({ onComplete }: SplashScreenProps) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onComplete, 400);
    }, 1800);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background"
        >
          <div className="flex flex-col items-center gap-6">
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 180, damping: 18, delay: 0.15 }}
              className="relative"
            >
              <img
                src={astrazLogo}
                alt="Astraz"
                className="w-36 h-36 object-contain drop-shadow-[0_0_24px_hsl(270_80%_60%/0.4)]"
              />
              {[1, 2].map((i) => (
                <motion.div
                  key={i}
                  initial={{ scale: 0.8, opacity: 0.4 }}
                  animate={{ scale: 2.2, opacity: 0 }}
                  transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' }}
                  className="absolute inset-0 rounded-full border border-primary/30"
                />
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-center"
            >
              <h1 className="text-3xl font-display font-bold xai-gradient-text">Astraz</h1>
              <p className="text-sm text-muted-foreground mt-1.5">Your Intelligent AI Assistant</p>
            </motion.div>

            <motion.div
              initial={{ width: 0 }}
              animate={{ width: '160px' }}
              transition={{ duration: 1.2, delay: 0.3, ease: 'easeInOut' }}
              className="h-0.5 bg-gradient-to-r from-xai-purple to-xai-cyan rounded-full overflow-hidden"
            >
              <motion.div
                animate={{ x: ['-100%', '100%'] }}
                transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                className="h-full w-1/3 bg-white/40"
              />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SplashScreen;
