import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import astrazFullLogo from '@/assets/astraz-full-logo.png';

interface PwaSplashScreenProps {
  onComplete: () => void;
}

/**
 * Full-screen, app-like animated splash. Used ONLY when the app is launched
 * as an installed PWA (display-mode: standalone). The web version keeps the
 * lighter <SplashScreen />.
 *
 * Performance-tuned: no per-frame JS particles or expanding rings — those
 * caused jank on mid-range mobile. Uses CSS-only halo + a single spring on
 * the logo.
 */
export const PwaSplashScreen = ({ onComplete }: PwaSplashScreenProps) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onComplete, 400);
    }, 2000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[200] overflow-hidden"
          style={{
            background:
              'radial-gradient(ellipse at 30% 20%, hsl(248 70% 18%) 0%, hsl(232 60% 9%) 45%, hsl(228 55% 5%) 100%)',
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {/* Static aurora glow (no animation) */}
          <div
            aria-hidden
            className="absolute -top-1/4 -left-1/4 w-[80vmax] h-[80vmax] rounded-full blur-3xl opacity-40"
            style={{ background: 'radial-gradient(circle, hsl(var(--xai-purple) / 0.55), transparent 60%)' }}
          />
          <div
            aria-hidden
            className="absolute -bottom-1/4 -right-1/4 w-[70vmax] h-[70vmax] rounded-full blur-3xl opacity-40"
            style={{ background: 'radial-gradient(circle, hsl(var(--xai-cyan) / 0.5), transparent 60%)' }}
          />

          {/* Center stage */}
          <div className="relative h-full w-full flex flex-col items-center justify-center gap-10 px-8">
            <div className="relative flex items-center justify-center">
              {/* Soft halo — CSS-only */}
              <div
                aria-hidden
                className="absolute rounded-full animate-pulse"
                style={{
                  width: 220,
                  height: 220,
                  background:
                    'radial-gradient(circle, hsl(var(--xai-purple) / 0.35), transparent 70%)',
                  filter: 'blur(8px)',
                }}
              />

              {/* Logo */}
              <motion.div
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                className="relative z-10"
              >
                <img
                  src={astrazFullLogo}
                  alt="Astraz"
                  className="w-28 h-28 rounded-3xl object-cover"
                  style={{
                    background: '#0a0a1a',
                    boxShadow:
                      '0 0 40px hsl(var(--xai-purple) / 0.55), 0 0 80px hsl(var(--xai-cyan) / 0.3), inset 0 0 0 1px hsl(0 0% 100% / 0.08)',
                  }}
                />
              </motion.div>
            </div>

            {/* Wordmark */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="text-center"
            >
              <h1 className="text-5xl font-display font-bold xai-gradient-text tracking-tight">
                Astraz
              </h1>
              <p className="text-[0.78rem] uppercase tracking-[0.35em] text-muted-foreground mt-3">
                Astral Intelligence
              </p>
            </motion.div>
          </div>

          {/* Bottom indeterminate bar (CSS-only) + signature */}
          <div
            className="absolute left-0 right-0 bottom-0 flex flex-col items-center gap-4 pb-10"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 2.5rem)' }}
          >
            <div className="relative w-40 h-[3px] rounded-full overflow-hidden bg-white/10">
              <div
                className="absolute inset-y-0 -left-1/3 w-1/3 rounded-full pwa-splash-slide"
                style={{
                  background:
                    'linear-gradient(90deg, hsl(var(--xai-purple)), hsl(var(--xai-cyan)))',
                  boxShadow: '0 0 12px hsl(var(--xai-purple) / 0.7)',
                }}
              />
            </div>
            <p className="text-[0.65rem] tracking-[0.3em] uppercase text-muted-foreground opacity-60">
              by Astrinique
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PwaSplashScreen;
