import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PhoneOff, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { VoiceOrb } from "./VoiceOrb";

interface VoiceCallProps {
  onClose: () => void;
}

const VOICE_OPTIONS = [
  { id: "asteria", name: "Asteria", gender: "feminine" },
  { id: "luna", name: "Luna", gender: "feminine" },
  { id: "athena", name: "Athena", gender: "feminine" },
  { id: "hera", name: "Hera", gender: "feminine" },
  { id: "stella", name: "Stella", gender: "feminine" },
  { id: "aurora", name: "Aurora", gender: "feminine" },
  { id: "thalia", name: "Thalia", gender: "feminine" },
  { id: "cordelia", name: "Cordelia", gender: "feminine" },
  { id: "orion", name: "Orion", gender: "masculine" },
  { id: "zeus", name: "Zeus", gender: "masculine" },
  { id: "helios", name: "Helios", gender: "masculine" },
  { id: "arcas", name: "Arcas", gender: "masculine" },
  { id: "perseus", name: "Perseus", gender: "masculine" },
  { id: "angus", name: "Angus", gender: "masculine" },
  { id: "orpheus", name: "Orpheus", gender: "masculine" },
  { id: "apollo", name: "Apollo", gender: "masculine" },
];

export const VoiceCall = ({ onClose }: VoiceCallProps) => {
  const { toast } = useToast();
  const [callStart] = useState(() => Date.now());
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(() =>
    localStorage.getItem("xai-tts-voice") || "asteria"
  );
  const [status, setStatus] = useState<"idle" | "connecting" | "listening" | "processing" | "speaking">("idle");
  const [isConnected, setIsConnected] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const currentAudioRef = useRef<AudioBufferSourceNode | null>(null);
  const isActiveRef = useRef(true);
  const selectedVoiceRef = useRef(selectedVoice);
  const isMutedRef = useRef(isMuted);
  const audioContextRef = useRef<AudioContext | null>(null);
  const conversationHistoryRef = useRef<Array<{ role: string; content: string }>>([]);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micAnimFrameRef = useRef<number>(0);
  const processingRunRef = useRef(0);

  useEffect(() => { selectedVoiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  useEffect(() => {
    const t = setInterval(() => setCallDuration(Math.floor((Date.now() - callStart) / 1000)), 1000);
    return () => clearInterval(t);
  }, [callStart]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getOrCreateAudioContext = useCallback(() => {
    let ctx = audioContextRef.current;
    if (!ctx || ctx.state === "closed") {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
    }
    return ctx;
  }, []);

  const stopCurrentAudio = useCallback(() => {
    if (currentAudioRef.current) {
      try { currentAudioRef.current.stop(); } catch {}
      currentAudioRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  // --- Mic level tracking ---
  const startMicLevelTracking = useCallback(() => {
    if (!streamRef.current) return;
    const ctx = getOrCreateAudioContext();
    const source = ctx.createMediaStreamSource(streamRef.current);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    micAnalyserRef.current = analyser;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const update = () => {
      if (!isActiveRef.current) return;
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
      setAudioLevel(avg / 255);
      micAnimFrameRef.current = requestAnimationFrame(update);
    };
    micAnimFrameRef.current = requestAnimationFrame(update);
  }, [getOrCreateAudioContext]);

  const stopMicLevelTracking = useCallback(() => {
    if (micAnimFrameRef.current) {
      cancelAnimationFrame(micAnimFrameRef.current);
      micAnimFrameRef.current = 0;
    }
    setAudioLevel(0);
  }, []);

  // --- Auth headers helper ---
  const getHeaders = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    return {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    };
  }, []);

  // --- TTS for a single sentence ---
  const fetchTTS = useCallback(async (text: string, headers: Record<string, string>): Promise<ArrayBuffer | null> => {
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text, voiceId: selectedVoiceRef.current }),
      });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("audio")) return null;
      return await res.arrayBuffer();
    } catch {
      return null;
    }
  }, []);

  // --- Play an audio buffer with output level tracking ---
  const playAudioBuffer = useCallback((arrayBuffer: ArrayBuffer): Promise<void> => {
    return new Promise(async (resolve) => {
      if (!isActiveRef.current) { resolve(); return; }
      try {
        const ctx = getOrCreateAudioContext();
        if (ctx.state === "suspended") await ctx.resume();

        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;

        const gainNode = ctx.createGain();
        gainNode.gain.value = 3.0;
        source.connect(gainNode);

        // Analyser for output level → orb reactivity
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        gainNode.connect(analyser);
        analyser.connect(ctx.destination);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let animFrame = 0;
        const updateLevel = () => {
          if (!isActiveRef.current) return;
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
          setAudioLevel(avg / 255);
          animFrame = requestAnimationFrame(updateLevel);
        };
        animFrame = requestAnimationFrame(updateLevel);

        currentAudioRef.current = source;
        source.onended = () => {
          cancelAnimationFrame(animFrame);
          currentAudioRef.current = null;
          setAudioLevel(0);
          resolve();
        };
        source.start(0);
      } catch (e) {
        console.error("playAudioBuffer error:", e);
        resolve();
      }
    });
  }, [getOrCreateAudioContext]);

  // --- STT ---
  const transcribeAudio = useCallback(async (audioBlob: Blob, headers: Record<string, string>): Promise<string | null> => {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64Audio = btoa(binary);

    const sttRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/speech-to-text`, {
      method: "POST",
      headers,
      body: JSON.stringify({ audio: base64Audio }),
    });
    if (!sttRes.ok) throw new Error("STT failed");
    const { transcript, error } = await sttRes.json();
    if (error) throw new Error(error);
    if (!transcript || transcript.trim() === "") return null;
    console.log("Transcribed:", transcript);
    return transcript;
  }, []);

  // --- Main pipeline: STT → Stream LLM → Progressive TTS ---
  const processAudio = useCallback(async (audioBlob: Blob) => {
    if (!isActiveRef.current || isMutedRef.current) return;
    const runId = ++processingRunRef.current;
    const isRunActive = () => isActiveRef.current && !isMutedRef.current && runId === processingRunRef.current;

    setStatus("listening");
    stopMicLevelTracking();

    try {
      const headers = await getHeaders();

      // 1. Speech-to-Text
      const transcript = await transcribeAudio(audioBlob, headers);
      if (!transcript || !isRunActive()) {
        if (isRunActive()) {
          setStatus("listening");
          startListening();
        } else {
          setStatus("idle");
        }
        return;
      }

      conversationHistoryRef.current.push({ role: "user", content: transcript });

      // 2. Stream LLM response
      const chatResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: conversationHistoryRef.current,
          isVoiceMode: true,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          clientTimeISO: new Date().toISOString(),
        }),
      });

      if (!chatResponse.ok) throw new Error("Chat failed");
      if (!isRunActive()) {
        setStatus("idle");
        return;
      }

      // Parse SSE stream, detect sentence boundaries, fire TTS immediately
      const reader = chatResponse.body!.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let fullResponse = "";
      let sentenceBuffer = "";
      let streamDone = false;

      // TTS jobs fire as sentences are detected; played in order
      const ttsJobs: Promise<ArrayBuffer | null>[] = [];

      const flushSentence = (sentence: string) => {
        if (!sentence.trim()) return;
        ttsJobs.push(fetchTTS(sentence.trim(), headers));
      };

      // Playback loop runs concurrently with streaming
      let playIndex = 0;
      const playbackLoop = async () => {
        while (isRunActive()) {
          if (playIndex < ttsJobs.length) {
            const audio = await ttsJobs[playIndex];
            if (audio && isRunActive()) {
              setStatus("speaking");
              await playAudioBuffer(audio);
            }
            playIndex++;
          } else if (streamDone) {
            break;
          } else {
            await new Promise(r => setTimeout(r, 30));
          }
        }
      };

      // Start playback in background (will wait for first TTS to complete)
      const playbackPromise = playbackLoop();

      // Read SSE stream
      while (!streamDone && isRunActive()) {
        const { done, value } = await reader.read();
        if (done) { streamDone = true; break; }
        sseBuffer += decoder.decode(value, { stream: true });

        let newlineIndex;
        while ((newlineIndex = sseBuffer.indexOf("\n")) !== -1) {
          let line = sseBuffer.slice(0, newlineIndex);
          sseBuffer = sseBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullResponse += content;
              sentenceBuffer += content;

              // Detect sentence boundary — fire TTS on very short fragments for speed
              const boundaryMatch = sentenceBuffer.match(/[.!?,;\n]/);
              if (boundaryMatch && sentenceBuffer.length > 4) {
                const idx = sentenceBuffer.lastIndexOf(boundaryMatch[0]) + 1;
                const sentence = sentenceBuffer.slice(0, idx);
                sentenceBuffer = sentenceBuffer.slice(idx);
                flushSentence(sentence);
              }
            }
          } catch {}
        }
      }

      // Flush any remaining text
      if (sentenceBuffer.trim()) {
        flushSentence(sentenceBuffer);
      }
      streamDone = true;

      // Wait for all audio to finish playing
      await playbackPromise;
      if (!isRunActive()) {
        setStatus("idle");
        return;
      }

      // Save to history
      if (fullResponse) {
        conversationHistoryRef.current.push({ role: "assistant", content: fullResponse });
      }

      // Resume listening
      setStatus("listening");
      startListening();
    } catch (error) {
      console.error("Process error:", error);
      toast({ title: "Processing failed", variant: "destructive" });
      if (isActiveRef.current && !isMutedRef.current) {
        setStatus("listening");
        startListening();
      }
    }
  }, [getHeaders, transcribeAudio, fetchTTS, playAudioBuffer, stopMicLevelTracking, toast]);

  // --- Listening with silence detection ---
  const startListening = useCallback(() => {
    if (!streamRef.current || isMutedRef.current || !isActiveRef.current) return;

    audioChunksRef.current = [];
    startMicLevelTracking();

    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";

    const options = mimeType ? { mimeType } : undefined;

    try {
      const mediaRecorder = new MediaRecorder(streamRef.current, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        stopMicLevelTracking();

        if (isMutedRef.current || !isActiveRef.current) {
          audioChunksRef.current = [];
          setStatus("idle");
          return;
        }

        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType || "audio/webm" });
          if (audioBlob.size > 1000) {
            processAudio(audioBlob);
          } else {
            setStatus("listening");
            startListening();
          }
        }
      };

      mediaRecorder.onerror = () => {
        if (isActiveRef.current && !isMutedRef.current) {
          setTimeout(() => startListening(), 500);
        }
      };

      mediaRecorder.start();
      setStatus("listening");

      // Silence detection
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(streamRef.current!);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      let silenceStart: number | null = null;
      let hasSpoken = false;
      const SILENCE_THRESHOLD = 15;
      const SPEECH_THRESHOLD = 23;
      const SILENCE_DURATION = 700; // Faster handoff into response
      const MAX_RECORD_TIME = 50000;
      const MAX_INITIAL_SILENCE = 8000;
      const recordStart = Date.now();

      const checkSilence = () => {
        if (mediaRecorder.state !== "recording" || !isActiveRef.current) {
          audioContext.close().catch(() => {});
          return;
        }

        if (Date.now() - recordStart > MAX_RECORD_TIME) {
          mediaRecorder.stop();
          audioContext.close().catch(() => {});
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;

        if (avg >= SPEECH_THRESHOLD) {
          hasSpoken = true;
          // Interrupt AI if speaking
          if (currentAudioRef.current) {
            stopCurrentAudio();
            setStatus("listening");
          }
        }

        if (avg < SILENCE_THRESHOLD) {
          if (!silenceStart) silenceStart = Date.now();
          const elapsed = Date.now() - silenceStart;
          if (hasSpoken && elapsed > SILENCE_DURATION) {
            mediaRecorder.stop();
            audioContext.close().catch(() => {});
            return;
          }
          if (!hasSpoken && elapsed > MAX_INITIAL_SILENCE) {
            mediaRecorder.stop();
            audioContext.close().catch(() => {});
            return;
          }
        } else {
          silenceStart = null;
        }

        requestAnimationFrame(checkSilence);
      };

      requestAnimationFrame(checkSilence);
    } catch (error) {
      console.error("MediaRecorder error:", error);
      toast({ title: "Recording failed", variant: "destructive" });
    }
  }, [processAudio, stopCurrentAudio, startMicLevelTracking, stopMicLevelTracking, toast]);

  const startCall = useCallback(async () => {
    setStatus("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      streamRef.current = stream;
      isActiveRef.current = true;
      setIsConnected(true);

      // Pre-unlock AudioContext for iOS
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (ctx.state === "suspended") await ctx.resume();
        const silentBuffer = ctx.createBuffer(1, 1, 22050);
        const silentSource = ctx.createBufferSource();
        silentSource.buffer = silentBuffer;
        silentSource.connect(ctx.destination);
        silentSource.start(0);
        audioContextRef.current = ctx;
      } catch (e) {
        console.warn("AudioContext pre-unlock failed:", e);
      }

      startListening();
    } catch (error) {
      console.error("Microphone error:", error);
      let errorMessage = "Could not access microphone";
      if (error instanceof Error) {
        if (error.name === "NotAllowedError") errorMessage = "Microphone access denied. Please allow microphone access in your browser settings.";
        else if (error.name === "NotFoundError") errorMessage = "No microphone found on this device.";
        else if (error.name === "NotReadableError") errorMessage = "Microphone is already in use by another application.";
      }
      toast({ title: errorMessage, variant: "destructive" });
      setStatus("idle");
    }
  }, [startListening, toast]);

  const endCall = useCallback(() => {
    isActiveRef.current = false;
    stopMicLevelTracking();

    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    stopCurrentAudio();
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setIsConnected(false);
    setStatus("idle");
    onClose();
  }, [onClose, stopCurrentAudio, stopMicLevelTracking]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    isMutedRef.current = next;

    if (next) {
      processingRunRef.current += 1;
      if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
      stopCurrentAudio();
      stopMicLevelTracking();
      setStatus("idle");
    } else if (isConnected) {
      setStatus("listening");
      startListening();
    }
  }, [isMuted, isConnected, startListening, stopCurrentAudio, stopMicLevelTracking]);

  useEffect(() => {
    startCall();
    return () => {
      isActiveRef.current = false;
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusLabel =
    status === "connecting" ? "Connecting…" :
    status === "listening" ? "Listening…" :
    status === "processing" ? "Responding…" :
    status === "speaking" ? "Speaking…" : "Ready";

  const feminineVoices = VOICE_OPTIONS.filter(v => v.gender === "feminine");
  const masculineVoices = VOICE_OPTIONS.filter(v => v.gender === "masculine");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black"
    >
      <div className="flex flex-col items-center gap-4 p-6 sm:p-8 max-w-md w-full h-full justify-between pt-12 pb-10">
        <div className="text-center">
          <p className="text-white/50 text-sm font-mono tracking-widest">{formatDuration(callDuration)}</p>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <VoiceOrb status={status} isMuted={isMuted} audioLevel={audioLevel} />
        </div>

        <div className="text-center mb-2">
          <p className={cn(
            "text-sm font-medium tracking-wide transition-colors",
            status === "speaking" ? "text-cyan-400" :
            status === "listening" ? "text-emerald-400" :
            status === "processing" ? "text-cyan-300" :
            "text-white/40"
          )}>
            {statusLabel}
          </p>
        </div>

        <div className="w-full rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-3">
          <select
            value={selectedVoice}
            onChange={(e) => {
              const newVoice = e.target.value;
              setSelectedVoice(newVoice);
              selectedVoiceRef.current = newVoice;
              localStorage.setItem("xai-tts-voice", newVoice);
            }}
            className="w-full h-9 rounded-md border border-white/10 bg-black/50 px-3 text-sm text-white outline-none"
          >
            <optgroup label="Feminine Voices">
              {feminineVoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </optgroup>
            <optgroup label="Masculine Voices">
              {masculineVoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </optgroup>
          </select>
        </div>

        <div className="flex items-center gap-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMute}
            className={cn(
              "h-14 w-14 rounded-full border transition-all",
              isMuted
                ? "border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                : "border-white/20 bg-white/5 text-white hover:bg-white/10"
            )}
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={endCall}
            className="h-16 w-16 rounded-full bg-red-500 hover:bg-red-600 text-white"
            aria-label="End call"
          >
            <PhoneOff className="h-7 w-7" />
          </Button>
        </div>

        {!isConnected && status !== "connecting" && (
          <Button variant="outline" onClick={startCall} className="w-full border-white/20 text-white hover:bg-white/10">
            Reconnect
          </Button>
        )}
      </div>
    </motion.div>
  );
};
