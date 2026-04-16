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
 * Premium animated voice orb — uses layered canvas glow + framer-motion morphing.
 * Responds to real-time audio levels with organic, fluid animation.
 */
export const VoiceOrb = ({ status, isMuted, audioLevel = 0, className }: VoiceOrbProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef(0);

  const isSpeaking = status === "speaking";
  const isListening = status === "listening";
  const isConnecting = status === "connecting";
  const isActive = isSpeaking || isListening;

  // Canvas glow animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 300;
    canvas.width = size * 2;
    canvas.height = size * 2;

    const draw = () => {
      phaseRef.current += 0.015;
      const t = phaseRef.current;
      ctx.clearRect(0, 0, size * 2, size * 2);
      const cx = size;
      const cy = size;

      // Outer nebula layers
      const layers = isMuted ? 1 : isActive ? 4 : isConnecting ? 3 : 2;
      for (let i = layers; i >= 0; i--) {
        const spread = 80 + i * 28 + (isActive ? audioLevel * 40 : 0);
        const wobble = isActive ? Math.sin(t * 2 + i) * audioLevel * 15 : Math.sin(t + i) * 4;
        const alpha = isMuted ? 0.03 : isActive ? 0.08 + audioLevel * 0.12 : isConnecting ? 0.06 : 0.04;

        let r: number, g: number, b: number;
        if (isMuted) {
          r = 100; g = 100; b = 100;
        } else if (isSpeaking) {
          r = 100 + Math.sin(t + i) * 40;
          g = 180 + Math.cos(t * 0.7 + i) * 40;
          b = 255;
        } else if (isListening) {
          r = 40 + Math.sin(t * 0.8 + i) * 30;
          g = 210 + Math.cos(t + i) * 30;
          b = 160 + Math.sin(t * 1.2 + i) * 40;
        } else if (isConnecting) {
          r = 160 + Math.sin(t * 1.5 + i) * 40;
          g = 100 + Math.cos(t + i) * 30;
          b = 240;
        } else {
          r = 140; g = 160; b = 200;
        }

        const grad = ctx.createRadialGradient(
          cx + wobble, cy + Math.cos(t + i * 0.5) * wobble * 0.7,
          0,
          cx, cy,
          spread
        );
        grad.addColorStop(0, `rgba(${r},${g},${b},${alpha * 1.5})`);
        grad.addColorStop(0.5, `rgba(${r},${g},${b},${alpha})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size * 2, size * 2);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(animRef.current); };
  }, [isMuted, isSpeaking, isListening, isConnecting, isActive, audioLevel]);

  const levelScale = 1 + audioLevel * 0.3;
  const orbSize = 150;

  return (
    <div className={cn("relative flex items-center justify-center", className)} style={{ width: 300, height: 300 }}>
      {/* Canvas glow background */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: 300, height: 300 }}
      />

      {/* Orbital ring 1 */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 220,
          height: 220,
          border: `1px solid ${isMuted ? "rgba(255,255,255,0.04)" : isSpeaking ? "rgba(6,182,212,0.3)" : isListening ? "rgba(16,185,129,0.25)" : "rgba(139,92,246,0.15)"}`,
        }}
        animate={{
          scale: isActive ? [1, 1 + audioLevel * 0.08, 1] : isConnecting ? [1, 1.04, 1] : 1,
          rotate: isConnecting ? 360 : isActive ? [0, 3, -3, 0] : 0,
          opacity: isMuted ? 0.3 : 1,
        }}
        transition={{
          scale: { duration: isActive ? 0.15 : 3, repeat: isConnecting ? Infinity : 0 },
          rotate: { duration: isConnecting ? 8 : 4, repeat: Infinity, ease: "linear" },
          opacity: { duration: 0.5 },
        }}
      />

      {/* Orbital ring 2 (counter-rotate) */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 195,
          height: 195,
          border: `1px solid ${isMuted ? "rgba(255,255,255,0.03)" : isSpeaking ? "rgba(139,92,246,0.25)" : isListening ? "rgba(6,182,212,0.2)" : "rgba(100,120,180,0.1)"}`,
        }}
        animate={{
          rotate: isConnecting ? -360 : isActive ? [0, -2, 2, 0] : 0,
          scale: isActive ? [1, 1 + audioLevel * 0.05, 1] : 1,
        }}
        transition={{
          rotate: { duration: isConnecting ? 12 : 6, repeat: Infinity, ease: "linear" },
          scale: { duration: 0.15 },
        }}
      />

      {/* Particle dots */}
      {!isMuted && [0, 1, 2, 3, 4, 5].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 3 + (isActive ? audioLevel * 3 : 0),
            height: 3 + (isActive ? audioLevel * 3 : 0),
            background: isSpeaking ? "rgb(103,232,249)" : isListening ? "rgb(52,211,153)" : "rgb(167,139,250)",
          }}
          animate={{
            x: [
              Math.cos((i / 6) * Math.PI * 2) * 95,
              Math.cos((i / 6) * Math.PI * 2 + 0.3) * (95 + (isActive ? audioLevel * 20 : 5)),
              Math.cos((i / 6) * Math.PI * 2) * 95,
            ],
            y: [
              Math.sin((i / 6) * Math.PI * 2) * 95,
              Math.sin((i / 6) * Math.PI * 2 + 0.3) * (95 + (isActive ? audioLevel * 20 : 5)),
              Math.sin((i / 6) * Math.PI * 2) * 95,
            ],
            opacity: isActive ? [0.4, 0.9, 0.4] : isConnecting ? [0.2, 0.5, 0.2] : 0.2,
          }}
          transition={{
            duration: isActive ? 0.8 + i * 0.1 : 3 + i * 0.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Main orb body */}
      <motion.div
        className="relative rounded-full overflow-hidden"
        style={{ width: orbSize, height: orbSize }}
        animate={{
          scale: isActive ? levelScale : isMuted ? 0.88 : isConnecting ? [1, 1.04, 1] : [1, 1.015, 1],
        }}
        transition={{
          duration: isActive ? 0.1 : 2.5,
          repeat: isConnecting || (!isActive && !isMuted) ? Infinity : 0,
          ease: "easeOut",
        }}
      >
        {/* Deep gradient core */}
        <motion.div
          className="absolute inset-0"
          style={{
            background: isMuted
              ? "radial-gradient(circle at 45% 40%, #2a2a2a 0%, #111 100%)"
              : isSpeaking
              ? "radial-gradient(circle at 40% 35%, #67e8f9 0%, #0891b2 25%, #7c3aed 55%, #4c1d95 100%)"
              : isListening
              ? "radial-gradient(circle at 40% 35%, #6ee7b7 0%, #059669 30%, #0891b2 65%, #164e63 100%)"
              : isConnecting
              ? "radial-gradient(circle at 40% 35%, #c4b5fd 0%, #7c3aed 35%, #0891b2 70%, #0e7490 100%)"
              : "radial-gradient(circle at 40% 35%, #cbd5e1 0%, #64748b 35%, #334155 70%, #0f172a 100%)",
          }}
          animate={{
            rotate: isConnecting ? [0, 360] : [0, 8, -4, 0],
          }}
          transition={{
            duration: isConnecting ? 4 : 12,
            repeat: Infinity,
            ease: isConnecting ? "linear" : "easeInOut",
          }}
        />

        {/* Liquid morph overlay */}
        <motion.div
          className="absolute inset-0"
          style={{
            background: isMuted ? "none" : isSpeaking
              ? "conic-gradient(from 0deg, transparent 0%, rgba(103,232,249,0.2) 25%, transparent 50%, rgba(139,92,246,0.15) 75%, transparent 100%)"
              : isListening
              ? "conic-gradient(from 0deg, transparent 0%, rgba(52,211,153,0.15) 25%, transparent 50%, rgba(6,182,212,0.1) 75%, transparent 100%)"
              : "none",
          }}
          animate={{
            rotate: [0, 360],
            scale: isActive ? [1, 1 + audioLevel * 0.15, 1] : 1,
          }}
          transition={{
            rotate: { duration: isActive ? 2 : 8, repeat: Infinity, ease: "linear" },
            scale: { duration: 0.15 },
          }}
        />

        {/* Glass highlight */}
        <motion.div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(ellipse at 35% 25%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.15) 25%, transparent 55%)",
          }}
          animate={{
            opacity: isMuted ? 0.08 : isActive ? 0.25 + audioLevel * 0.35 : [0.2, 0.35, 0.2],
          }}
          transition={{
            duration: isActive ? 0.12 : 3,
            repeat: isActive ? 0 : Infinity,
            ease: "easeOut",
          }}
        />

        {/* Bottom shadow for depth */}
        <div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(ellipse at 55% 75%, rgba(0,0,0,0.4) 0%, transparent 55%)",
          }}
        />
      </motion.div>
    </div>
  );
};
