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

  const isSpeaking = status === "speaking";
  const isListening = status === "listening";
  const isActive = isSpeaking || isListening;
  const size = 320;
  const radius = 96 + (isMuted ? -3 : audioLevel * 12);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = size * 2;
    canvas.height = size * 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);

    const clouds = [
      { r: 86, sx: 18, sy: 12, speed: 0.56, color: "hsl(var(--foreground) / 0.92)" },
      { r: 72, sx: 25, sy: 18, speed: 0.81, color: "hsl(var(--foreground) / 0.62)" },
      { r: 66, sx: 22, sy: 16, speed: 0.71, color: "hsl(var(--xai-cyan) / 0.38)" },
      { r: 56, sx: 16, sy: 22, speed: 0.63, color: "hsl(var(--foreground) / 0.48)" },
    ];

    const draw = () => {
      phaseRef.current += isActive ? 0.028 : 0.012;
      const t = phaseRef.current;
      const cx = size / 2;
      const cy = size / 2;

      ctx.clearRect(0, 0, size, size);

      const outerGlow = ctx.createRadialGradient(cx, cy, radius * 0.7, cx, cy, radius * 1.9);
      outerGlow.addColorStop(0, isSpeaking ? "hsl(var(--xai-cyan) / 0.18)" : "hsl(var(--foreground) / 0.08)");
      outerGlow.addColorStop(0.62, isListening ? "hsl(var(--xai-purple) / 0.12)" : "hsl(var(--xai-cyan) / 0.08)");
      outerGlow.addColorStop(1, "hsl(var(--background) / 0)");
      ctx.fillStyle = outerGlow;
      ctx.fillRect(0, 0, size, size);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      const baseFill = ctx.createLinearGradient(cx, cy - radius, cx, cy + radius);
      baseFill.addColorStop(0, "hsl(var(--foreground) / 0.98)");
      baseFill.addColorStop(0.42, "hsl(var(--foreground) / 0.9)");
      baseFill.addColorStop(0.75, "hsl(var(--xai-cyan) / 0.22)");
      baseFill.addColorStop(1, "hsl(var(--xai-cyan) / 0.94)");
      ctx.fillStyle = baseFill;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      ctx.globalCompositeOperation = "screen";
      for (const [index, cloud] of clouds.entries()) {
        const x = cx + Math.cos(t * cloud.speed + index * 1.2) * (cloud.sx + audioLevel * 6);
        const y = cy + Math.sin(t * (cloud.speed * 0.85) + index * 1.5) * (cloud.sy + audioLevel * 5) - 8;
        const g = ctx.createRadialGradient(x, y, radius * 0.06, x, y, cloud.r + audioLevel * 14);
        g.addColorStop(0, cloud.color);
        g.addColorStop(0.56, index === 2 ? "hsl(var(--xai-cyan) / 0.2)" : "hsl(var(--foreground) / 0.22)");
        g.addColorStop(1, "hsl(var(--background) / 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, cloud.r + audioLevel * 10, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = "overlay";
      const lowerBlue = ctx.createLinearGradient(cx, cy - radius * 0.2, cx, cy + radius);
      lowerBlue.addColorStop(0, "hsl(var(--xai-cyan) / 0)");
      lowerBlue.addColorStop(0.55, "hsl(var(--xai-cyan) / 0.14)");
      lowerBlue.addColorStop(1, "hsl(var(--xai-cyan) / 0.96)");
      ctx.fillStyle = lowerBlue;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      ctx.globalCompositeOperation = "soft-light";
      const sheen = ctx.createRadialGradient(cx - radius * 0.26, cy - radius * 0.35, 0, cx - radius * 0.26, cy - radius * 0.35, radius * 0.9);
      sheen.addColorStop(0, "hsl(var(--foreground) / 0.52)");
      sheen.addColorStop(1, "hsl(var(--foreground) / 0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      ctx.restore();
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 1, 0, Math.PI * 2);
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
      animate={{ scale: isMuted ? 0.985 : isActive ? [1, 1.02 + audioLevel * 0.04, 1] : [1, 1.008, 1] }}
      transition={{ duration: isActive ? 0.42 : 3.2, repeat: Infinity, ease: "easeInOut" }}
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
