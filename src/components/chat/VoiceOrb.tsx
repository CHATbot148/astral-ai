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
 * Cloud-like animated orb. Renders to a canvas with a stable RAF loop that
 * reads audio level + status from refs (so React renders never restart the
 * loop — that was causing the orb to appear invisible).
 */
export const VoiceOrb = ({ status, isMuted, audioLevel = 0, className }: VoiceOrbProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef(0);
  const smoothLevelRef = useRef(0);

  // Live state mirrors so the RAF loop never has stale values.
  const audioLevelRef = useRef(audioLevel);
  const isMutedRef = useRef(isMuted);
  const statusRef = useRef(status);

  useEffect(() => { audioLevelRef.current = audioLevel; }, [audioLevel]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { statusRef.current = status; }, [status]);

  const size = 320;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const clouds = [
      { r: 92, sx: 18, sy: 14, speed: 0.52, hue: "var(--foreground)", a: 0.9 },
      { r: 80, sx: 24, sy: 18, speed: 0.74, hue: "var(--foreground)", a: 0.7 },
      { r: 72, sx: 28, sy: 14, speed: 0.68, hue: "var(--xai-cyan)", a: 0.55 },
      { r: 66, sx: 18, sy: 26, speed: 0.59, hue: "var(--xai-purple)", a: 0.42 },
      { r: 50, sx: 14, sy: 20, speed: 0.86, hue: "var(--foreground)", a: 0.5 },
    ];

    const draw = () => {
      const target = isMutedRef.current ? 0 : audioLevelRef.current;
      smoothLevelRef.current += (target - smoothLevelRef.current) * 0.18;
      const level = smoothLevelRef.current;
      const st = statusRef.current;
      const isActive = st === "listening" || st === "speaking";
      phaseRef.current += isActive ? 0.024 + level * 0.022 : 0.011;
      const t = phaseRef.current;
      const cx = size / 2;
      const cy = size / 2;
      const baseRadius = 96;
      const activeRadius = baseRadius + level * 22 + (isActive ? 4 : 0);

      // Reset compositing each frame
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, size, size);

      // Outer halo
      const halo = ctx.createRadialGradient(cx, cy, activeRadius * 0.6, cx, cy, activeRadius * 2.2);
      halo.addColorStop(
        0,
        st === "speaking" ? "hsl(var(--xai-cyan) / 0.32)" : st === "listening" ? "hsl(var(--xai-purple) / 0.26)" : "hsl(var(--foreground) / 0.12)"
      );
      halo.addColorStop(1, "hsl(var(--background) / 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);

      // Clip to circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, activeRadius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      // OPAQUE base fill so the orb is always clearly visible
      const base = ctx.createRadialGradient(cx, cy - activeRadius * 0.3, activeRadius * 0.1, cx, cy, activeRadius);
      base.addColorStop(0, "hsl(var(--foreground) / 0.98)");
      base.addColorStop(0.55, "hsl(var(--foreground) / 0.85)");
      base.addColorStop(0.85, "hsl(var(--xai-cyan) / 0.7)");
      base.addColorStop(1, "hsl(var(--xai-purple) / 0.85)");
      ctx.fillStyle = base;
      ctx.fillRect(cx - activeRadius, cy - activeRadius, activeRadius * 2, activeRadius * 2);

      // Drifting cloud blobs (lighten so they brighten the surface)
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        const x = cx + Math.cos(t * c.speed + i * 1.2) * (c.sx + level * 16);
        const y = cy + Math.sin(t * (c.speed * 0.85) + i * 1.5) * (c.sy + level * 14) - 6;
        const g = ctx.createRadialGradient(x, y, c.r * 0.05, x, y, c.r + level * 16);
        g.addColorStop(0, `hsl(${c.hue} / ${c.a})`);
        g.addColorStop(0.55, `hsl(${c.hue} / ${c.a * 0.35})`);
        g.addColorStop(1, "hsl(var(--background) / 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, c.r + level * 14, 0, Math.PI * 2);
        ctx.fill();
      }

      // Lower color wash
      ctx.globalCompositeOperation = "overlay";
      const wash = ctx.createLinearGradient(cx, cy - activeRadius * 0.4, cx, cy + activeRadius);
      wash.addColorStop(0, "hsl(var(--xai-purple) / 0)");
      wash.addColorStop(0.6, "hsl(var(--xai-cyan) / 0.22)");
      wash.addColorStop(1, "hsl(var(--xai-cyan) / 0.85)");
      ctx.fillStyle = wash;
      ctx.fillRect(cx - activeRadius, cy - activeRadius, activeRadius * 2, activeRadius * 2);

      // Top sheen
      ctx.globalCompositeOperation = "soft-light";
      const sheen = ctx.createRadialGradient(cx - activeRadius * 0.3, cy - activeRadius * 0.4, 0, cx - activeRadius * 0.3, cy - activeRadius * 0.4, activeRadius);
      sheen.addColorStop(0, "hsl(0 0% 100% / 0.6)");
      sheen.addColorStop(1, "hsl(0 0% 100% / 0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(cx - activeRadius, cy - activeRadius, activeRadius * 2, activeRadius * 2);

      ctx.restore();

      // Outline ring
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath();
      ctx.arc(cx, cy, activeRadius + 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = "hsl(var(--foreground) / 0.18)";
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
      style={{ width: size, height: size }}
      animate={{
        scale: isMuted ? 0.985 : isActive ? [1, 1.04 + audioLevel * 0.08, 1] : [1, 1.012, 1],
      }}
      transition={{ duration: isActive ? 0.45 : 3.2, repeat: Infinity, ease: "easeInOut" }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: size, height: size }}
      />
      <motion.div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          boxShadow: isMuted
            ? "0 0 60px hsl(var(--muted-foreground) / 0.1)"
            : status === "speaking"
              ? "0 0 110px hsl(var(--xai-cyan) / 0.32)"
              : status === "listening"
                ? "0 0 110px hsl(var(--xai-purple) / 0.22)"
                : "0 0 80px hsl(var(--foreground) / 0.12)",
        }}
        animate={{ opacity: isMuted ? 0.3 : isActive ? [0.45, 0.7, 0.45] : [0.25, 0.35, 0.25] }}
        transition={{ duration: isActive ? 1.6 : 3.2, repeat: Infinity, ease: "easeInOut" }}
      />
    </motion.div>
  );
};
