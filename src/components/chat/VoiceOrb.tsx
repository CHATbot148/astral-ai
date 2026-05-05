import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface VoiceOrbProps {
  status: "idle" | "connecting" | "listening" | "speaking";
  isMuted: boolean;
  audioLevel?: number;
  className?: string;
}

export const VoiceOrb = ({ status, isMuted, audioLevel = 0, className }: VoiceOrbProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef(0);
  const smoothLevelRef = useRef(0);

  const isSpeaking = status === "speaking";
  const isListening = status === "listening";
  const isActive = isSpeaking || isListening;
  const size = 320;
  const radius = 94 + (isMuted ? -4 : audioLevel * 20);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = size * 2;
    canvas.height = size * 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);

    const clouds = [
      { r: 94, sx: 16, sy: 12, speed: 0.52, color: "hsl(var(--foreground) / 0.96)" },
      { r: 82, sx: 23, sy: 17, speed: 0.74, color: "hsl(var(--foreground) / 0.72)" },
      { r: 74, sx: 28, sy: 14, speed: 0.68, color: "hsl(var(--xai-cyan) / 0.42)" },
      { r: 68, sx: 18, sy: 26, speed: 0.59, color: "hsl(var(--xai-purple) / 0.26)" },
      { r: 52, sx: 14, sy: 20, speed: 0.86, color: "hsl(var(--foreground) / 0.4)" },
    ];

    const draw = () => {
      smoothLevelRef.current += (audioLevel - smoothLevelRef.current) * (isActive ? 0.18 : 0.08);
      const level = isMuted ? 0 : smoothLevelRef.current;
      phaseRef.current += isActive ? 0.024 + level * 0.02 : 0.01;
      const t = phaseRef.current;
      const cx = size / 2;
      const cy = size / 2;
      const activeRadius = 94 + level * 22;

      ctx.clearRect(0, 0, size, size);

      const outerGlow = ctx.createRadialGradient(cx, cy, activeRadius * 0.55, cx, cy, activeRadius * 2.1);
      outerGlow.addColorStop(0, isSpeaking ? "hsl(var(--xai-cyan) / 0.22)" : "hsl(var(--foreground) / 0.08)");
      outerGlow.addColorStop(0.62, isListening ? "hsl(var(--xai-purple) / 0.16)" : "hsl(var(--xai-cyan) / 0.1)");
      outerGlow.addColorStop(1, "hsl(var(--background) / 0)");
      ctx.fillStyle = outerGlow;
      ctx.fillRect(0, 0, size, size);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, activeRadius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      const baseFill = ctx.createLinearGradient(cx, cy - activeRadius, cx, cy + activeRadius);
      baseFill.addColorStop(0, "hsl(var(--foreground) / 0.98)");
      baseFill.addColorStop(0.42, "hsl(var(--foreground) / 0.9)");
      baseFill.addColorStop(0.75, "hsl(var(--xai-cyan) / 0.22)");
      baseFill.addColorStop(1, "hsl(var(--xai-cyan) / 0.94)");
      ctx.fillStyle = baseFill;
      ctx.fillRect(cx - activeRadius, cy - activeRadius, activeRadius * 2, activeRadius * 2);

      ctx.globalCompositeOperation = "screen";
      for (const [index, cloud] of clouds.entries()) {
        const x = cx + Math.cos(t * cloud.speed + index * 1.2) * (cloud.sx + level * 14);
        const y = cy + Math.sin(t * (cloud.speed * 0.85) + index * 1.5) * (cloud.sy + level * 12) - 8;
        const g = ctx.createRadialGradient(x, y, activeRadius * 0.05, x, y, cloud.r + level * 20);
        g.addColorStop(0, cloud.color);
        g.addColorStop(0.56, index === 2 ? "hsl(var(--xai-cyan) / 0.2)" : "hsl(var(--foreground) / 0.22)");
        g.addColorStop(1, "hsl(var(--background) / 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, cloud.r + level * 16, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = "overlay";
      const lowerBlue = ctx.createLinearGradient(cx, cy - activeRadius * 0.2, cx, cy + activeRadius);
      lowerBlue.addColorStop(0, "hsl(var(--xai-cyan) / 0)");
      lowerBlue.addColorStop(0.55, "hsl(var(--xai-cyan) / 0.14)");
      lowerBlue.addColorStop(1, "hsl(var(--xai-cyan) / 0.96)");
      ctx.fillStyle = lowerBlue;
      ctx.fillRect(cx - activeRadius, cy - activeRadius, activeRadius * 2, activeRadius * 2);

      ctx.globalCompositeOperation = "soft-light";
      const sheen = ctx.createRadialGradient(cx - activeRadius * 0.26, cy - activeRadius * 0.35, 0, cx - activeRadius * 0.26, cy - activeRadius * 0.35, activeRadius * 0.9);
      sheen.addColorStop(0, "hsl(var(--foreground) / 0.52)");
      sheen.addColorStop(1, "hsl(var(--foreground) / 0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(cx - activeRadius, cy - activeRadius, activeRadius * 2, activeRadius * 2);

      ctx.restore();
      ctx.beginPath();
      ctx.arc(cx, cy, activeRadius + 1, 0, Math.PI * 2);
      ctx.strokeStyle = "hsl(var(--foreground) / 0.16)";
      ctx.lineWidth = 1;
      ctx.stroke();

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [audioLevel, isActive, isListening, isSpeaking, isMuted, radius]);

  return (
    <motion.div
      className={cn("relative flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      animate={{ scale: isMuted ? 0.985 : isActive ? [1, 1.03 + audioLevel * 0.08, 1] : [1, 1.008, 1] }}
      transition={{ duration: isActive ? 0.34 : 3.2, repeat: Infinity, ease: "easeInOut" }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" style={{ width: size, height: size }} />
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          boxShadow: isMuted
            ? "0 0 60px hsl(var(--muted-foreground) / 0.08)"
            : isSpeaking
              ? "0 0 90px hsl(var(--xai-cyan) / 0.24)"
              : isListening
                ? "0 0 90px hsl(var(--xai-purple) / 0.16)"
                : "0 0 70px hsl(var(--foreground) / 0.08)",
        }}
        animate={{ opacity: isMuted ? 0.28 : isActive ? [0.3, 0.56, 0.3] : [0.16, 0.24, 0.16] }}
        transition={{ duration: isActive ? 1.5 : 3.2, repeat: Infinity, ease: "easeInOut" }}
      />
    </motion.div>
  );
};
