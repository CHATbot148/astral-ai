import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface VoiceOrbProps {
  status: "idle" | "connecting" | "listening" | "speaking";
  isMuted: boolean;
  audioLevel?: number;
  className?: string;
}

/**
 * Lively circular orb. A single canvas draws a soft animated gradient sphere
 * with a couple of inner currents that breathe with `audioLevel`. Designed to
 * feel alive even when idle, beautiful when listening, and electric when
 * speaking — without metaballs that previously rendered invisibly.
 */
export const VoiceOrb = ({ status, isMuted, audioLevel = 0, className }: VoiceOrbProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef(0);
  const smoothLevelRef = useRef(0);

  const audioLevelRef = useRef(audioLevel);
  const isMutedRef = useRef(isMuted);
  const statusRef = useRef(status);

  useEffect(() => { audioLevelRef.current = audioLevel; }, [audioLevel]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { statusRef.current = status; }, [status]);

  const SIZE = 260;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const draw = () => {
      const target = isMutedRef.current ? 0 : audioLevelRef.current;
      smoothLevelRef.current += (target - smoothLevelRef.current) * 0.18;
      const level = smoothLevelRef.current;
      const st = statusRef.current;
      const isActive = st === "listening" || st === "speaking";
      phaseRef.current += isActive ? 0.018 + level * 0.025 : 0.006;
      const t = phaseRef.current;

      const cx = SIZE / 2;
      const cy = SIZE / 2;
      const baseR = 92;
      const r = baseR + level * 18 + (isActive ? 3 : 0);

      ctx.clearRect(0, 0, SIZE, SIZE);

      // Outer glow halo
      const haloColor =
        st === "speaking" ? "hsl(190 95% 60% / 0.42)" :
        st === "listening" ? "hsl(265 85% 65% / 0.36)" :
        "hsl(220 30% 60% / 0.18)";
      const halo = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 2.1);
      halo.addColorStop(0, haloColor);
      halo.addColorStop(1, "hsl(0 0% 0% / 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, SIZE, SIZE);

      // Main sphere body
      const sphere = ctx.createRadialGradient(
        cx - r * 0.35, cy - r * 0.4, r * 0.05,
        cx, cy, r
      );
      if (st === "speaking") {
        sphere.addColorStop(0, "hsl(190 100% 92%)");
        sphere.addColorStop(0.5, "hsl(190 95% 58%)");
        sphere.addColorStop(1, "hsl(265 85% 28%)");
      } else if (st === "listening") {
        sphere.addColorStop(0, "hsl(265 100% 92%)");
        sphere.addColorStop(0.5, "hsl(265 90% 62%)");
        sphere.addColorStop(1, "hsl(220 60% 22%)");
      } else {
        sphere.addColorStop(0, "hsl(220 30% 92%)");
        sphere.addColorStop(0.55, "hsl(230 35% 55%)");
        sphere.addColorStop(1, "hsl(230 40% 14%)");
      }
      ctx.fillStyle = sphere;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Inner liquid currents — two soft offset highlights breathing with audio
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();

      ctx.globalCompositeOperation = "lighter";
      const swayX = Math.cos(t * 0.9) * (10 + level * 18);
      const swayY = Math.sin(t * 1.1) * (8 + level * 14);
      const c1 = ctx.createRadialGradient(
        cx + swayX, cy - r * 0.15 + swayY, 0,
        cx + swayX, cy - r * 0.15 + swayY, r * 0.8
      );
      c1.addColorStop(0, st === "speaking" ? "hsl(190 100% 75% / 0.55)" : "hsl(265 95% 75% / 0.45)");
      c1.addColorStop(1, "hsl(0 0% 0% / 0)");
      ctx.fillStyle = c1;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

      const swayX2 = Math.cos(t * 1.3 + 1.5) * (8 + level * 12);
      const swayY2 = Math.sin(t * 0.7 + 0.8) * (12 + level * 16);
      const c2 = ctx.createRadialGradient(
        cx + swayX2, cy + r * 0.2 + swayY2, 0,
        cx + swayX2, cy + r * 0.2 + swayY2, r * 0.65
      );
      c2.addColorStop(0, st === "speaking" ? "hsl(265 90% 70% / 0.4)" : "hsl(190 95% 70% / 0.35)");
      c2.addColorStop(1, "hsl(0 0% 0% / 0)");
      ctx.fillStyle = c2;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

      // Top sheen
      ctx.globalCompositeOperation = "soft-light";
      const sheen = ctx.createRadialGradient(
        cx - r * 0.35, cy - r * 0.5, 0,
        cx - r * 0.35, cy - r * 0.5, r * 0.9
      );
      sheen.addColorStop(0, "hsl(0 0% 100% / 0.65)");
      sheen.addColorStop(1, "hsl(0 0% 100% / 0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

      ctx.restore();

      // Crisp rim
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath();
      ctx.arc(cx, cy, r + 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = "hsl(0 0% 100% / 0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  const isActive = status === "listening" || status === "speaking";

  return (
    <motion.div
      className={cn("relative flex items-center justify-center", className)}
      style={{ width: SIZE, height: SIZE }}
      animate={{
        scale: isMuted ? 0.97 : isActive ? [1, 1.05 + audioLevel * 0.1, 1] : [1, 1.015, 1],
      }}
      transition={{ duration: isActive ? 0.5 : 3.4, repeat: Infinity, ease: "easeInOut" }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: SIZE, height: SIZE }}
      />
    </motion.div>
  );
};
