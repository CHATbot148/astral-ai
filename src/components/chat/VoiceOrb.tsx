import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface VoiceOrbProps {
  status: "idle" | "connecting" | "listening" | "processing" | "speaking";
  isMuted: boolean;
  audioLevel?: number; // 0-1, drives dynamic scaling
  className?: string;
}

/**
 * A premium animated orb for voice call UI.
 * Now reacts to real-time audio levels from mic input and AI speech output.
 */
export const VoiceOrb = ({ status, isMuted, audioLevel = 0, className }: VoiceOrbProps) => {
  const isSpeaking = status === "speaking";
  const isListening = status === "listening";
  const isProcessing = status === "connecting";

  // Dynamic scale based on audio level
  const levelScale = 1 + audioLevel * 0.25; // 1.0 – 1.25
  const ringScale = 1 + audioLevel * 0.18;

  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      {/* Outer glow rings */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 260,
          height: 260,
          background: isMuted
            ? "radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%)"
            : isSpeaking
            ? "radial-gradient(circle, rgba(0,200,255,0.15) 0%, rgba(139,92,246,0.08) 50%, transparent 70%)"
            : isListening
            ? "radial-gradient(circle, rgba(16,185,129,0.12) 0%, rgba(0,200,255,0.06) 50%, transparent 70%)"
            : "radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%)",
        }}
        animate={{
          scale: (isSpeaking || isListening) ? ringScale : isProcessing ? [1, 1.05, 1] : 1,
        }}
        transition={{
          duration: (isSpeaking || isListening) ? 0.1 : 2.5,
          repeat: isProcessing ? Infinity : 0,
          ease: "easeOut",
        }}
      />

      {/* Ring 1 - outer animated ring */}
      <motion.div
        className="absolute rounded-full border"
        style={{
          width: 200,
          height: 200,
          borderColor: isMuted
            ? "rgba(255,255,255,0.05)"
            : isSpeaking
            ? "rgba(0,200,255,0.4)"
            : isListening
            ? "rgba(16,185,129,0.3)"
            : isProcessing
            ? "rgba(139,92,246,0.3)"
            : "rgba(255,255,255,0.08)",
        }}
        animate={{
          scale: (isSpeaking || isListening) ? ringScale * 1.02 : isProcessing ? [1, 1.03, 1] : [1, 1.01, 1],
          rotate: isProcessing ? [0, 360] : 0,
        }}
        transition={{
          duration: (isSpeaking || isListening) ? 0.1 : isProcessing ? 3 : 3,
          repeat: isProcessing ? Infinity : 0,
          ease: "easeOut",
        }}
      />

      {/* Ring 2 - middle ring */}
      <motion.div
        className="absolute rounded-full border"
        style={{
          width: 180,
          height: 180,
          borderColor: isMuted
            ? "rgba(255,255,255,0.03)"
            : isSpeaking
            ? "rgba(139,92,246,0.35)"
            : isListening
            ? "rgba(0,200,255,0.2)"
            : isProcessing
            ? "rgba(0,200,255,0.2)"
            : "rgba(255,255,255,0.05)",
        }}
        animate={{
          scale: (isSpeaking || isListening) ? ringScale : [1, 1.005, 1],
          rotate: isProcessing ? [0, -360] : 0,
        }}
        transition={{
          duration: (isSpeaking || isListening) ? 0.1 : isProcessing ? 4 : 4,
          repeat: isProcessing ? Infinity : 0,
          ease: "easeOut",
        }}
      />

      {/* Main orb */}
      <motion.div
        className="relative rounded-full overflow-hidden"
        style={{ width: 160, height: 160 }}
        animate={{
          scale: (isSpeaking || isListening) ? levelScale : isMuted ? 0.92 : isProcessing ? [1, 1.03, 1] : [1, 1.01, 1],
        }}
        transition={{
          duration: (isSpeaking || isListening) ? 0.08 : 2.5,
          repeat: isProcessing ? Infinity : 0,
          ease: "easeOut",
        }}
      >
        {/* Gradient background */}
        <motion.div
          className="absolute inset-0"
          style={{
            background: isMuted
              ? "radial-gradient(circle at 40% 40%, #333 0%, #1a1a1a 100%)"
              : isSpeaking
              ? "radial-gradient(circle at 40% 35%, #67e8f9 0%, #06b6d4 30%, #8b5cf6 70%, #6d28d9 100%)"
              : isListening
              ? "radial-gradient(circle at 40% 35%, #a7f3d0 0%, #10b981 40%, #06b6d4 80%, #0284c7 100%)"
              : isProcessing
              ? "radial-gradient(circle at 40% 35%, #c4b5fd 0%, #8b5cf6 40%, #06b6d4 80%, #0e7490 100%)"
              : "radial-gradient(circle at 40% 35%, #e2e8f0 0%, #94a3b8 40%, #475569 80%, #1e293b 100%)",
          }}
          animate={{
            rotate: isProcessing ? [0, 360] : [0, 5, 0],
          }}
          transition={{
            duration: isProcessing ? 6 : 8,
            repeat: Infinity,
            ease: "linear",
          }}
        />

        {/* Highlight / shimmer */}
        <motion.div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.1) 30%, transparent 60%)",
          }}
          animate={{
            opacity: isMuted ? 0.1 : (isSpeaking || isListening) ? 0.3 + audioLevel * 0.5 : [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: (isSpeaking || isListening) ? 0.1 : 3,
            repeat: (isSpeaking || isListening) ? 0 : Infinity,
            ease: "easeOut",
          }}
        />

        {/* Inner depth layer */}
        <motion.div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(circle at 60% 70%, rgba(0,0,0,0.3) 0%, transparent 50%)",
          }}
        />
      </motion.div>
    </div>
  );
};
