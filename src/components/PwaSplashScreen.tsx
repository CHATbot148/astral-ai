import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import astrazFullLogo from '@/assets/astraz-full-logo.png';

interface PwaSplashScreenProps {
  onComplete: () => void;
}

/**
 * Full-screen, app-like animated splash. Used ONLY when the app is launched
 * as an installed PWA (display-mode: standalone). The web version keeps the
 * lighter <SplashScreen />.
 */
export const PwaSplashScreen = ({ onComplete }: PwaSplashScreenProps) => {
  const [isVisible, setIsVisible] = useState(true);
  const [progress, setProgress] = useState(0);

  // Pre-compute orbiting particle positions
  const particles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        angle: (i / 14) * Math.PI * 2,
        delay: i * 0.08,
        size: 2 + (i % 3),
      })),
    []
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onComplete, 500);
    }, 2600);
    return () => clearTimeout(timer);
  }, [onComplete]);

  useEffect(() => {
    const start = performance.now();
    const duration = 2400;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(100, ((now - start) / duration) * 100);
      setProgress(p);
      if (p < 100) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.05 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[200] overflow-hidden"
          style={{
            background:
              'radial-gradient(ellipse at 30% 20%, hsl(248 70% 18%) 0%, hsl(232 60% 9%) 45%, hsl(228 55% 5%) 100%)',
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {/* Aurora blobs */}
          <motion.div
            aria-hidden
            className="absolute -top-1/4 -left-1/4 w-[80vmax] h-[80vmax] rounded-full blur-3xl opacity-40"
            style={{ background: 'radial-gradient(circle, hsl(var(--xai-purple) / 0.55), transparent 60%)' }}
            animate={{ x: [0, 40, -20, 0], y: [0, -30, 20, 0] }}
            transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            aria-hidden
            className="absolute -bottom-1/4 -right-1/4 w-[70vmax] h-[70vmax] rounded-full blur-3xl opacity-40"
            style={{ background: 'radial-gradient(circle, hsl(var(--xai-cyan) / 0.5), transparent 60%)' }}
            animate={{ x: [0, -30, 20, 0], y: [0, 20, -30, 0] }}
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Subtle grid */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage:
                'linear-gradient(hsl(0 0% 100% / 0.5) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100% / 0.5) 1px, transparent 1px)',
              backgroundSize: '44px 44px',
              maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 75%)',
            }}
          />

          {/* Center stage */}
          <div className="relative h-full w-full flex flex-col items-center justify-center gap-10 px-8">
            <div className="relative flex items-center justify-center">
              {/* Orbiting particles */}
              {particles.map((p, i) => (
                <motion.span
                  key={i}
                  className="absolute rounded-full"
                  style={{
                    width: p.size,
                    height: p.size,
                    background:
                      i % 2 === 0 ? 'hsl(var(--xai-cyan))' : 'hsl(var(--xai-purple))',
                    boxShadow: `0 0 10px hsl(var(--xai-${i % 2 === 0 ? 'cyan' : 'purple'}) / 0.9)`,
                  }}
                  animate={{
                    x: [Math.cos(p.angle) * 90, Math.cos(p.angle + Math.PI * 2) * 90],
                    y: [Math.sin(p.angle) * 90, Math.sin(p.angle + Math.PI * 2) * 90],
                    opacity: [0, 1, 0],
                  }}
                  transition={{
                    duration: 4,
                    repeat: Infinity,
                    delay: p.delay,
                    ease: 'linear',
                  }}
                />
              ))}

              {/* Expanding rings */}
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={`ring-${i}`}
                  className="absolute rounded-full"
                  style={{
                    width: 160,
                    height: 160,
                    border: '1px solid hsl(var(--xai-purple) / 0.5)',
                  }}
                  initial={{ scale: 0.6, opacity: 0.7 }}
                  animate={{ scale: 2.4, opacity: 0 }}
                  transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: 'easeOut' }}
                />
              ))}

              {/* Logo */}
              <motion.div
                initial={{ scale: 0.4, opacity: 0, rotate: -25 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 180, damping: 18, delay: 0.15 }}
                className="relative z-10"
              >
                <motion.div
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
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
              </motion.div>
            </div>

            {/* Wordmark */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="text-center"
            >
              <h1 className="text-5xl font-display font-bold xai-gradient-text tracking-tight">
                Astraz
              </h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.9 }}
                className="text-[0.78rem] uppercase tracking-[0.35em] text-muted-foreground mt-3"
              >
                Astral Intelligence
              </motion.p>
            </motion.div>
          </div>

          {/* Bottom progress + signature */}
          <div
            className="absolute left-0 right-0 bottom-0 flex flex-col items-center gap-4 pb-10"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 2.5rem)' }}
          >
            <div className="relative w-40 h-[3px] rounded-full overflow-hidden bg-white/10">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${progress}%`,
                  background:
                    'linear-gradient(90deg, hsl(var(--xai-purple)), hsl(var(--xai-cyan)))',
                  boxShadow: '0 0 12px hsl(var(--xai-purple) / 0.7)',
                }}
              />
            </div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              transition={{ delay: 1.1 }}
              className="text-[0.65rem] tracking-[0.3em] uppercase text-muted-foreground"
            >
              by Astrinique
            </motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PwaSplashScreen;
