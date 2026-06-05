import { memo, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { LineChart, Brain, FileText, Sparkles } from 'lucide-react';
import astrazLogo from '@/assets/astraz-logo.png';
import { useAuth } from '@/hooks/useAuth';

interface WelcomeScreenProps {
  onAnalyzeDocs?: () => void;
  onVisualize?: () => void;
  profileName?: string | null;
}

const PLOT_PROMPTS = [
  'Plot a graph showing global smartphone shipments per quarter for the last 3 years.',
  'Plot a bar chart comparing the top 5 most spoken languages by number of speakers.',
  'Plot a line graph of average global temperature anomalies from 1980 to today.',
  'Plot a chart showing the top 7 highest-grossing films of all time.',
];

const getGreeting = (name?: string | null) => {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const n = name ? `, ${name}` : '';
  if (hour < 12) return `Good morning${n}`;
  if (hour < 18) return `Hi${n}, what's the move?`;
  return `Good evening${n}`;
};

/** Subtle halftone particle field that fades in/out every ~2s. */
const ParticleField = memo(() => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0, raf = 0;
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const start = performance.now();
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const elapsed = (t - start) / 1000;
      // 2s cycle fade
      const cycle = (elapsed % 4) / 4; // 0..1
      const alpha = cycle < 0.5 ? cycle * 2 : (1 - cycle) * 2;
      const spacing = 14;
      const cx = w / 2;
      const cy = h * 0.55;
      for (let y = 0; y < h; y += spacing) {
        for (let x = 0; x < w; x += spacing) {
          const dx = x - cx, dy = y - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          const falloff = Math.max(0, 1 - d / (Math.min(w, h) * 0.55));
          if (falloff <= 0) continue;
          const a = falloff * alpha * 0.55;
          const r = 1.1 + falloff * 0.6;
          ctx.fillStyle = `hsla(270, 80%, 65%, ${a})`;
          ctx.beginPath();
          ctx.arc(x + (Math.sin(elapsed + x) * 0.5), y + (Math.cos(elapsed + y) * 0.5), r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden />;
});
ParticleField.displayName = 'ParticleField';

export const WELCOME_SHORTCUTS = [
  { icon: Brain, title: 'Brainstorm ideas', type: 'prompt' as const, getValue: () => 'Generate creative ideas for my project' },
  { icon: LineChart, title: 'Plot graph', type: 'prompt' as const, getValue: () => PLOT_PROMPTS[Math.floor(Math.random() * PLOT_PROMPTS.length)] },
  { icon: FileText, title: 'Analyze documents', type: 'action' as const, getValue: () => 'analyze' },
  { icon: Sparkles, title: 'Visualize', type: 'action' as const, getValue: () => 'visualize' },
];

export const WelcomeScreen = memo(({ onAnalyzeDocs, onVisualize, profileName }: WelcomeScreenProps) => {
  const { user } = useAuth();
  const displayName = profileName || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || '';
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const firstName = displayName.trim().split(/\s+/)[0] || '';

  // Detect keyboard via visualViewport — lift content slightly when open
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setKeyboardOpen(window.innerHeight - vv.height > 100);
    vv.addEventListener('resize', update);
    update();
    return () => vv.removeEventListener('resize', update);
  }, []);

  const greeting = getGreeting(firstName);

  return (
    <div
      className="flex flex-col items-center justify-center relative w-full min-w-0 px-4 overflow-hidden"
      style={{ minHeight: `calc(100dvh - 14rem)` }}
    >
      {/* Particle field */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <ParticleField />
      </div>

      {/* Greeting block - centered, shifts up when keyboard opens */}
      <motion.div
        animate={{ y: keyboardOpen ? '-20%' : 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 26 }}
        className="flex flex-col items-center justify-center text-center relative z-10 w-full min-w-0"
      >
        <motion.img
          src={astrazLogo}
          alt="Astraz AI Assistant Logo"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, type: 'spring', stiffness: 200 }}
          className="w-14 h-14 sm:w-16 sm:h-16 object-contain mb-3 sm:mb-4"
        />
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-[1.5rem] sm:text-2xl md:text-3xl font-display font-medium text-foreground/95 leading-tight max-w-[min(78vw,22rem)] break-words"
        >
          {greeting}
        </motion.h1>
      </motion.div>
    </div>
  );
});

WelcomeScreen.displayName = 'WelcomeScreen';
