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
 * Rebuilt voice orb — a studio-style voice stage with beam core, live bands, and halo motion.
 */
export const VoiceOrb = ({ status, isMuted, audioLevel = 0, className }: VoiceOrbProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef(0);

  const isSpeaking = status === "speaking";
  const isListening = status === "listening";
  const isConnecting = status === "connecting";
  const isActive = isSpeaking || isListening;
  const frameTone = isMuted
    ? "hsl(var(--muted-foreground) / 0.18)"
    : isSpeaking
      ? "hsl(var(--xai-cyan) / 0.45)"
      : isListening
        ? "hsl(var(--xai-purple) / 0.42)"
        : "hsl(var(--border) / 0.5)";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 320;
    canvas.width = size * 2;
    canvas.height = size * 2;

    const draw = () => {
      phaseRef.current += isActive ? 0.028 : 0.014;
      const t = phaseRef.current;
      ctx.clearRect(0, 0, size * 2, size * 2);
      const cx = size;
      const cy = size;

      for (let i = 0; i < 3; i++) {
        const radius = 88 + i * 32 + (isActive ? audioLevel * 28 : 0);
        const dx = Math.cos(t * (0.7 + i * 0.18)) * (8 + i * 2);
        const dy = Math.sin(t * (0.9 + i * 0.15)) * (10 + i * 3);
        const gradient = ctx.createRadialGradient(cx + dx, cy + dy, 0, cx, cy, radius);
        const cyanAlpha = isMuted ? 0.02 : isSpeaking ? 0.16 : 0.08;
        const purpleAlpha = isMuted ? 0.01 : isListening ? 0.16 : 0.08;

        gradient.addColorStop(0, `hsl(190 95% 55% / ${cyanAlpha + audioLevel * 0.12})`);
        gradient.addColorStop(0.42, `hsl(270 85% 65% / ${purpleAlpha + audioLevel * 0.1})`);
        gradient.addColorStop(1, "hsl(240 18% 7% / 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size * 2, size * 2);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [audioLevel, isActive, isListening, isMuted, isSpeaking]);

  const bars = Array.from({ length: 9 }, (_, i) => i);
  const sparkRays = Array.from({ length: 12 }, (_, i) => i);

  return (
    <div className={cn("relative flex items-center justify-center", className)} style={{ width: 320, height: 320 }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: 320, height: 320 }}
      />

      <motion.div
        className="absolute inset-[18px] rounded-[40px] border backdrop-blur-2xl"
        style={{
          borderColor: frameTone,
          background: "linear-gradient(180deg, hsl(var(--card) / 0.3), hsl(var(--background) / 0.14))",
          boxShadow: "0 30px 90px hsl(var(--background) / 0.55), inset 0 1px 0 hsl(var(--foreground) / 0.04)",
        }}
        animate={{
          scale: isActive ? [1, 1.01 + audioLevel * 0.03, 1] : [1, 1.01, 1],
          opacity: isMuted ? 0.5 : 1,
        }}
        transition={{
          duration: isActive ? 0.22 : 2.8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      <motion.div
        className="absolute inset-[42px] rounded-[36px] border"
        style={{
          borderColor: "hsl(var(--foreground) / 0.06)",
        }}
        animate={{
          rotate: isConnecting ? 360 : isSpeaking ? [0, 2, 0, -2, 0] : 0,
          scale: isListening ? [1, 1.012, 1] : 1,
        }}
        transition={{
          rotate: { duration: isConnecting ? 6 : 5, repeat: Infinity, ease: "linear" },
          scale: { duration: 1.4, repeat: Infinity, ease: "easeInOut" },
        }}
      />

      {!isMuted && sparkRays.map((i) => (
        <motion.div
          key={i}
          className="absolute top-1/2 left-1/2 origin-center rounded-full"
          style={{
            width: 2,
            height: 34,
            background: "linear-gradient(180deg, hsl(var(--foreground) / 0), hsl(var(--xai-cyan) / 0.5), hsl(var(--foreground) / 0))",
            transform: `translate(-50%, -50%) rotate(${i * 30}deg) translateY(-118px)`,
          }}
          animate={{
            opacity: isActive ? [0.15, 0.5 + audioLevel * 0.3, 0.15] : 0.08,
            scaleY: isSpeaking ? [0.7, 1.3, 0.7] : [0.75, 1, 0.75],
          }}
          transition={{
            duration: 1 + i * 0.04,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      <motion.div
        className="relative h-[168px] w-[168px] overflow-hidden rounded-[34px] border border-white/10"
        style={{
          background: "linear-gradient(160deg, hsl(var(--card) / 0.92), hsl(var(--background) / 0.94))",
          boxShadow: "0 22px 70px hsl(var(--background) / 0.7), inset 0 1px 0 hsl(var(--foreground) / 0.08)",
        }}
        animate={{
          scale: isMuted ? 0.96 : isActive ? [1, 1.02 + audioLevel * 0.08, 1] : [1, 1.012, 1],
        }}
        transition={{
          duration: isActive ? 0.18 : 2.4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <motion.div
          className="absolute inset-[16px] rounded-[28px]"
          style={{
            background: isMuted
              ? "radial-gradient(circle at 50% 24%, hsl(var(--muted-foreground) / 0.25), hsl(var(--background)) 75%)"
              : isSpeaking
                ? "linear-gradient(180deg, hsl(var(--xai-cyan) / 0.95), hsl(var(--xai-purple) / 0.7) 58%, hsl(var(--background)) 100%)"
                : isListening
                  ? "linear-gradient(180deg, hsl(var(--xai-purple) / 0.92), hsl(var(--xai-cyan) / 0.56) 62%, hsl(var(--background)) 100%)"
                  : "linear-gradient(180deg, hsl(var(--secondary)), hsl(var(--background)))",
          }}
          animate={{
            backgroundPositionY: isActive ? ["0%", "100%", "0%"] : ["0%", "16%", "0%"],
          }}
          transition={{
            duration: isActive ? 2.1 : 4.2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        <motion.div
          className="absolute inset-x-[26px] top-[28px] h-[26px] rounded-full"
          style={{
            background: "linear-gradient(180deg, hsl(var(--foreground) / 0.26), hsl(var(--foreground) / 0))",
          }}
          animate={{
            opacity: isMuted ? 0.08 : isActive ? [0.12, 0.28, 0.12] : [0.08, 0.16, 0.08],
          }}
          transition={{
            duration: 2.4,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        <div className="absolute inset-x-[26px] bottom-[32px] flex items-end justify-center gap-[6px]">
          {bars.map((i) => {
            const dist = Math.abs(i - 4);
            const base = 20 - dist * 2;
            const activeBoost = isMuted ? 0 : audioLevel * (40 - dist * 4);
            return (
              <motion.div
                key={i}
                className="w-[8px] rounded-full"
                style={{
                  background: i % 2 === 0
                    ? "linear-gradient(180deg, hsl(var(--xai-cyan)), hsl(var(--xai-cyan) / 0.18))"
                    : "linear-gradient(180deg, hsl(var(--xai-purple)), hsl(var(--xai-purple) / 0.18))",
                }}
                animate={{
                  height: isMuted
                    ? 10
                    : isActive
                      ? [base, base + activeBoost, base + activeBoost * 0.45, base]
                      : [base, base + 8, base],
                  opacity: isMuted ? 0.24 : isActive ? 1 : 0.55,
                }}
                transition={{
                  duration: isActive ? 0.42 + i * 0.02 : 1.6 + i * 0.04,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.03,
                }}
              />
            );
          })}
        </div>
      </motion.div>
    </div>
  );
};
