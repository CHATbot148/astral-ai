import { memo, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { LineChart, Brain, FileText, Sparkles } from 'lucide-react';
import astrazLogo from '@/assets/astraz-logo.png';
import { useAuth } from '@/hooks/useAuth';

interface WelcomeScreenProps {
  onSuggestionClick: (suggestion: string) => void;
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

export const WelcomeScreen = memo(({ onSuggestionClick, onAnalyzeDocs, onVisualize, profileName }: WelcomeScreenProps) => {
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

  const suggestions = [
    { icon: Brain, title: 'Brainstorm ideas', onClick: () => onSuggestionClick('Generate creative ideas for my project') },
    { icon: LineChart, title: 'Plot graph', onClick: () => onSuggestionClick(PLOT_PROMPTS[Math.floor(Math.random() * PLOT_PROMPTS.length)]) },
    { icon: FileText, title: 'Analyze documents', onClick: () => onAnalyzeDocs?.() },
    { icon: Sparkles, title: 'Visualize', onClick: () => onVisualize?.() },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-end relative px-4 pb-2 min-h-[52vh] sm:min-h-[70vh] overflow-hidden">
      {/* Particle field */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden pointer-events-none">
        <ParticleField />
      </div>

      {/* Greeting block - elevates when keyboard opens */}
      <motion.div
        animate={{ y: keyboardOpen ? -16 : 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 26 }}
        className="flex flex-col items-center justify-center text-center relative z-10 w-full mt-auto mb-6 sm:mb-8"
      >
        <motion.img
          src={astrazLogo}
          alt="Astraz AI Assistant Logo"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, type: 'spring', stiffness: 200 }}
          className="w-12 h-12 sm:w-14 sm:h-14 object-contain mb-3 sm:mb-4"
        />
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-[1.5rem] sm:text-2xl md:text-3xl font-display font-medium text-foreground/95 leading-tight max-w-[min(80vw,22rem)] break-words"
        >
          {greeting}
        </motion.h1>
      </motion.div>

      {/* Horizontal-scroll suggestion chips, sitting just above the input */}
      <div className="relative z-10 w-full mt-1 mb-1">
        <div
          className="overflow-x-auto overflow-y-hidden no-scrollbar -mx-4 px-4 scroll-smooth"
          style={{ touchAction: 'pan-x', WebkitOverflowScrolling: 'touch' }}
        >
          <div className="flex gap-2 pb-1 w-max">
            {suggestions.map((s) => (
              <button
                key={s.title}
                onClick={s.onClick}
                className="flex items-center gap-2 shrink-0 px-3.5 py-2 rounded-full bg-card/80 border border-border/60 hover:border-primary/40 backdrop-blur-sm transition-colors text-sm whitespace-nowrap"
              >
                <s.icon className="h-4 w-4 text-primary" />
                <span className="text-foreground/90">{s.title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

WelcomeScreen.displayName = 'WelcomeScreen';
