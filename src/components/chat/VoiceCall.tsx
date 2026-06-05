import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, PhoneOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VoiceOrb } from "./VoiceOrb";
import { useGeminiLive } from "@/hooks/useGeminiLive";
import { detectTerminationIntent } from "@/lib/intent";
import { playEndedSound } from "@/lib/soundEffects";
import { getAISettings, getModeSystemPrompt } from "@/lib/aiSettings";

interface VoiceCallProps {
  open: boolean;
  onClose: () => void;
}

export interface VoiceCallHandle {
  startFromTrigger: () => Promise<void>;
}

const buildSystem = () => {
  const s = getAISettings();
  const personality = getModeSystemPrompt(s.mode, s.customPrompt);
  return `You are Astraz, a sophisticated AI voice persona on a real-time call.

${personality}

Keep replies brief and conversational. Adjust your tone to be helpful and articulate.

CRITICAL: If the user requests to end the call, hang up, stop, exit, or close the session (in any language), respond instantly with only a brief final word ("Goodbye!" or "Terminating session") then stay silent. Never claim you cannot hang up.`;
};

export const VoiceCall = forwardRef<VoiceCallHandle, VoiceCallProps>(({ open, onClose }, ref) => {
  const { status, transcripts, isMuted, toggleMute, userVolume, modelVolume, error, connect, disconnect, requestMicrophoneAccess } = useGeminiLive();
  const [activeStatus, setActiveStatus] = useState<'idle' | 'connecting' | 'connected' | 'exiting' | 'error'>('idle');
  const startedRef = useRef(false);

  const handleEndCall = () => {
    if (activeStatus === 'exiting' || activeStatus === 'idle') return;
    setActiveStatus('exiting');
    playEndedSound();
    setTimeout(() => {
      disconnect();
      setActiveStatus('idle');
      startedRef.current = false;
      onClose();
    }, 1800);
  };

  const handleStartCall = async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setActiveStatus('connecting');
    let stream: MediaStream | undefined;
    try {
      stream = await requestMicrophoneAccess();
    } catch (err: any) {
      startedRef.current = false;
      setActiveStatus('error');
      return;
    }
    await connect({
      systemInstruction: buildSystem(),
      voiceName: 'Puck',
      onTerminationTriggered: handleEndCall,
      stream,
    });
  };

  useEffect(() => {
    if (status === 'connecting') setActiveStatus('connecting');
    else if (status === 'connected') setActiveStatus('connected');
    else if (status === 'error') setActiveStatus('error');
  }, [status]);

  useEffect(() => {
    if (!open && startedRef.current) {
      disconnect();
      startedRef.current = false;
      setActiveStatus('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // User-spoken termination detector
  useEffect(() => {
    if (activeStatus !== 'connected') return;
    const userT = transcripts.filter(t => t.role === 'user');
    const latest = userT[userT.length - 1];
    if (latest?.text && detectTerminationIntent(latest.text)) handleEndCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcripts, activeStatus]);

  useImperativeHandle(ref, () => ({
    startFromTrigger: () => handleStartCall(),
  }));

  if (!open) return null;

  const latestUserText = transcripts.filter(t => t.role === 'user').slice(-1)[0]?.text;
  const latestModelText = transcripts.filter(t => t.role === 'model').slice(-1)[0]?.text;
  const statusLabel =
    activeStatus === 'connecting' ? 'Connecting…' :
    activeStatus === 'exiting' ? 'Ending call…' :
    activeStatus === 'error' ? (error || 'Error') :
    modelVolume > 0.05 ? 'Speaking…' :
    userVolume > 0.05 ? 'Listening…' :
    'Ready';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-[#050508] text-white flex flex-col"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between p-4 pt-safe">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-1.5 h-1.5 rounded-full",
            activeStatus === 'connected' ? 'bg-emerald-400 animate-pulse' :
            activeStatus === 'error' ? 'bg-red-500' : 'bg-slate-400'
          )} />
          <span className="text-[11px] font-medium uppercase tracking-widest text-white/60">
            Astraz Voice
          </span>
        </div>
        <Button variant="ghost" size="icon" onClick={handleEndCall} className="text-white/70 hover:text-white hover:bg-white/10">
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Orb area */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(79,70,229,0.25),transparent_70%)] pointer-events-none" />
        <div className="absolute inset-0 overflow-hidden opacity-30 pointer-events-none">
          <div className="absolute top-1/4 -left-20 w-96 h-96 bg-indigo-500 rounded-full blur-[120px]" />
          <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-purple-500 rounded-full blur-[120px]" />
        </div>

        <div className="w-full h-full max-w-[600px] max-h-[600px] absolute inset-0 m-auto">
          <VoiceOrb userVolume={userVolume} modelVolume={modelVolume} isMuted={isMuted} status={activeStatus} />
        </div>

        {/* Status label */}
        <div className="absolute bottom-8 left-0 right-0 px-6 text-center pointer-events-none">
          <AnimatePresence mode="wait">
            <motion.p
              key={statusLabel}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="text-sm text-white/70 font-medium"
            >
              {statusLabel}
            </motion.p>
          </AnimatePresence>
          {(latestUserText || latestModelText) && activeStatus === 'connected' && (
            <p className="text-xs text-white/40 mt-2 line-clamp-2">
              {latestModelText || latestUserText}
            </p>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="p-6 pb-8 flex items-center justify-center gap-5">
        <Button
          size="icon"
          onClick={toggleMute}
          disabled={activeStatus !== 'connected'}
          className={cn(
            "h-14 w-14 rounded-full border border-white/15 backdrop-blur",
            isMuted ? "bg-red-500/20 text-red-300 hover:bg-red-500/30" : "bg-white/10 text-white hover:bg-white/15"
          )}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </Button>
        <Button
          size="icon"
          onClick={handleEndCall}
          className="h-16 w-16 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-[0_8px_32px_-4px_rgba(239,68,68,0.5)]"
          aria-label="End call"
        >
          <PhoneOff className="h-6 w-6" />
        </Button>
      </div>
    </motion.div>
  );
});

VoiceCall.displayName = "VoiceCall";
