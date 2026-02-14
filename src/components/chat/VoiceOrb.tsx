import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface VoiceOrbProps {
  status: "idle" | "connecting" | "listening" | "processing" | "speaking";
  isMuted: boolean;
  className?: string;
}

/**
 * A premium animated orb for voice call UI.
 * Inspired by ElevenLabs / ChatGPT voice mode visuals.
 */
export const VoiceOrb = ({ status, isMuted, className }: VoiceOrbProps) => {
  const isActive = status === "speaking" || status === "listening";
  const isSpeaking = status === "speaking";
  const isListening = status === "listening";
  const isProcessing = status === "processing" || status === "connecting";

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
          scale: isSpeaking ? [1, 1.15, 1] : isListening ? [1, 1.08, 1] : isProcessing ? [1, 1.05, 1] : 1,
        }}
        transition={{
          duration: isSpeaking ? 1.2 : isListening ? 2 : 2.5,
          repeat: Infinity,
          ease: "easeInOut",
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
          scale: isSpeaking ? [1, 1.12, 1.02, 1.08, 1] : isListening ? [1, 1.06, 1] : isProcessing ? [1, 1.03, 1] : [1, 1.01, 1],
          rotate: isSpeaking ? [0, 5, -3, 2, 0] : isProcessing ? [0, 360] : 0,
        }}
        transition={{
          duration: isSpeaking ? 1.5 : isProcessing ? 3 : 3,
          repeat: Infinity,
          ease: "easeInOut",
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
          scale: isSpeaking ? [1.02, 1.1, 1, 1.06, 1.02] : isListening ? [1, 1.04, 1] : [1, 1.005, 1],
          rotate: isSpeaking ? [0, -4, 3, -1, 0] : isProcessing ? [0, -360] : 0,
        }}
        transition={{
          duration: isSpeaking ? 1.8 : isProcessing ? 4 : 4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Main orb */}
      <motion.div
        className="relative rounded-full overflow-hidden"
        style={{ width: 160, height: 160 }}
        animate={{
          scale: isSpeaking ? [1, 1.06, 0.98, 1.04, 1] : isListening ? [1, 1.03, 1] : isMuted ? 0.92 : [1, 1.01, 1],
        }}
        transition={{
          duration: isSpeaking ? 1.2 : 2.5,
          repeat: Infinity,
          ease: "easeInOut",
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
            rotate: isSpeaking ? [0, 15, -10, 5, 0] : isProcessing ? [0, 360] : [0, 5, 0],
          }}
          transition={{
            duration: isSpeaking ? 2 : isProcessing ? 6 : 8,
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
            opacity: isMuted ? 0.1 : isSpeaking ? [0.5, 0.8, 0.5] : [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: isSpeaking ? 1 : 3,
            repeat: Infinity,
            ease: "easeInOut",
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
