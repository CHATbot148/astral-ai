import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PhoneOff, Mic, MicOff, Volume2, Settings } from "lucide-react";
import { useConversation } from "@elevenlabs/react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface VoiceCallProps {
  onClose: () => void;
}

export const VoiceCall = ({ onClose }: VoiceCallProps) => {
  const { toast } = useToast();
  const [callStart] = useState(() => Date.now());
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [agentId, setAgentId] = useState(() => localStorage.getItem("xai-elevenlabs-agent-id") || "");
  const [isConnecting, setIsConnecting] = useState(false);

  const wasConnectedRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setCallDuration(Math.floor((Date.now() - callStart) / 1000)), 1000);
    return () => clearInterval(t);
  }, [callStart]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const conversation = useConversation({
    onConnect: () => {
      wasConnectedRef.current = true;
    },
    onDisconnect: () => {
      if (wasConnectedRef.current) {
        toast({ title: "Call ended" });
      }
    },
    onError: (error) => {
      console.error("ElevenLabs conversation error:", error);
      toast({
        title: "Voice call error",
        description: "Could not connect to the voice agent.",
        variant: "destructive",
      });
    },
  });

  const statusLabel = useMemo(() => {
    if (isConnecting) return "Connecting…";
    if (conversation.status === "connected") return conversation.isSpeaking ? "X-AI is speaking…" : "Listening…";
    return "Disconnected";
  }, [conversation.isSpeaking, conversation.status, isConnecting]);

  const start = useCallback(async () => {
    if (!agentId.trim()) {
      toast({
        title: "Agent ID required",
        description: "Open settings and paste your ElevenLabs Agent ID.",
        variant: "destructive",
      });
      return;
    }

    setIsConnecting(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const { data, error } = await supabase.functions.invoke("elevenlabs-conversation-token", {
        body: { agentId: agentId.trim() },
      });
      if (error) throw error;
      if (!data?.token) throw new Error("No token returned");

      await conversation.startSession({
        conversationToken: data.token,
        connectionType: "webrtc",
      });

      if (isMuted) {
        await conversation.setVolume({ volume: 0 });
      } else {
        await conversation.setVolume({ volume: 1 });
      }
    } catch (e) {
      console.error("Failed to start call:", e);
      toast({
        title: "Could not start call",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  }, [agentId, conversation, isMuted, toast]);

  const end = useCallback(async () => {
    try {
      await conversation.endSession();
    } finally {
      onClose();
    }
  }, [conversation, onClose]);

  const toggleMute = useCallback(async () => {
    const next = !isMuted;
    setIsMuted(next);
    if (conversation.status === "connected") {
      await conversation.setVolume({ volume: next ? 0 : 1 });
    }
  }, [conversation, isMuted]);

  const saveAgentId = () => {
    localStorage.setItem("xai-elevenlabs-agent-id", agentId.trim());
    toast({ title: "Saved" });
  };

  useEffect(() => {
    // auto-start when modal opens
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-6 p-6 sm:p-8 max-w-md w-full">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-1">X-AI Call</h2>
          <p className="text-muted-foreground">{formatDuration(callDuration)}</p>
        </div>

        {/* Agent status */}
        <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-xai-cyan to-xai-purple flex items-center justify-center">
          {conversation.isSpeaking ? (
            <Volume2 className="h-12 w-12 text-white animate-pulse" />
          ) : conversation.status === "connected" ? (
            <Mic className="h-12 w-12 text-white" />
          ) : (
            <MicOff className="h-12 w-12 text-white/50" />
          )}

          <AnimatePresence>
            {conversation.status === "connected" && (
              <motion.div
                initial={{ scale: 1, opacity: 0.5 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="absolute inset-0 rounded-full bg-gradient-to-br from-xai-cyan to-xai-purple"
              />
            )}
          </AnimatePresence>
        </div>

        <div className="text-center min-h-[60px]">
          <p className={cn("text-sm", conversation.isSpeaking ? "text-xai-cyan" : "text-muted-foreground")}>
            {statusLabel}
          </p>
          {conversation.status !== "connected" && (
            <p className="text-xs text-muted-foreground mt-1">
              On iPhone, keep the phone off silent mode and raise media volume.
            </p>
          )}
        </div>

        {/* Settings */}
        <div className="w-full rounded-xl border border-border bg-card/50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Voice Agent</span>
          </div>
          <div className="flex gap-2">
            <input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="ElevenLabs Agent ID"
              className="flex-1 h-9 rounded-md border border-border bg-background px-3 text-sm outline-none"
            />
            <Button variant="secondary" onClick={saveAgentId} className="h-9">
              Save
            </Button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4">
          <Button
            variant="secondary"
            size="icon"
            onClick={toggleMute}
            className={cn("h-14 w-14 rounded-full", isMuted && "bg-destructive/20 text-destructive")}
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </Button>

          <Button
            variant="destructive"
            size="icon"
            onClick={end}
            className="h-16 w-16 rounded-full"
            aria-label="End call"
          >
            <PhoneOff className="h-7 w-7" />
          </Button>
        </div>

        {conversation.status !== "connected" && (
          <Button variant="xai" onClick={start} disabled={isConnecting} className="w-full">
            {isConnecting ? "Connecting…" : "Try again"}
          </Button>
        )}
      </div>
    </motion.div>
  );
};
