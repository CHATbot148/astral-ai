import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import astrazFullLogo from '@/assets/astraz-full-logo.png';

interface SplashScreenProps {
  onComplete: () => void;
}

export const SplashScreen = ({ onComplete }: SplashScreenProps) => {
  const [isVisible, setIsVisible] = useState(true);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onComplete, 400);
    }, 2200);
    return () => clearTimeout(timer);
  }, [onComplete]);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => Math.min(prev + 2, 100));
    }, 40);
    return () => clearInterval(interval);
  }, []);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background"
        >
          <div className="flex flex-col items-center gap-8">
            {/* Animated rings */}
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 150, damping: 20, delay: 0.1 }}
              className="relative"
            >
              <img
                src={astrazFullLogo}
                alt="Astraz"
                className="w-32 h-32 rounded-full object-cover drop-shadow-[0_0_30px_hsl(270_80%_60%/0.5)]"
                style={{ background: '#0a0a1a' }}
              />
              {/* Orbiting ring */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                className="absolute -inset-4"
              >
                <div className="w-full h-full rounded-full border-2 border-transparent" style={{ borderTopColor: 'hsl(270 80% 60% / 0.6)', borderRightColor: 'hsl(190 90% 48% / 0.4)' }} />
              </motion.div>
              {/* Pulsing glow rings */}
              {[1, 2, 3].map((i) => (
                <motion.div
                  key={i}
                  initial={{ scale: 0.8, opacity: 0.3 }}
                  animate={{ scale: 1.8 + i * 0.3, opacity: 0 }}
                  transition={{ duration: 2, repeat: Infinity, delay: i * 0.4, ease: 'easeOut' }}
                  className="absolute inset-0 rounded-full"
                  style={{ border: `1px solid hsl(${i % 2 === 0 ? '270 80% 60%' : '190 90% 48%'} / 0.3)` }}
                />
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-center"
            >
              <h1 className="text-4xl font-display font-bold xai-gradient-text tracking-tight">Astraz</h1>
              <p className="text-sm text-muted-foreground mt-2 tracking-wide">Your Intelligent AI Assistant</p>
            </motion.div>

            {/* Progress bar */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="w-48 h-1 bg-muted rounded-full overflow-hidden"
            >
              <div
                className="h-full bg-gradient-to-r from-xai-purple to-xai-cyan rounded-full transition-all duration-100 ease-out"
                style={{ width: `${progress}%` }}
              />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SplashScreen;
