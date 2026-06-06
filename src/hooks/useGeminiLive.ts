import { useState, useEffect, useRef, useCallback } from 'react';
import { pcmToBase64, base64ToFloat32 } from '@/lib/audio-utils';
import { playInitiatedSound, playMutedSound } from '@/lib/soundEffects';
import { detectTerminationIntent } from '@/lib/intent';
import { supabase } from '@/integrations/supabase/client';

export interface Transcript {
  id: string;
  text: string;
  role: 'user' | 'model';
  timestamp: number;
  final?: boolean;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const LIVE_INPUT_SAMPLE_RATE = 16000;
const LIVE_OUTPUT_SAMPLE_RATE = 24000;

export function useGeminiLive() {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [userVolume, setUserVolume] = useState(0);
  const [modelVolume, setModelVolume] = useState(0);
  const modelVolumeRef = useRef(0);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const modelAnalyserRef = useRef<AnalyserNode | null>(null);
  const userAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const shouldReconnectRef = useRef(false);
  const connectAbortRef = useRef<AbortController | null>(null);
  const sessionReadyRef = useRef(false);

  const requestMicrophoneAccess = useCallback(async () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtxRef.current = new AudioContextClass({ sampleRate: LIVE_OUTPUT_SAMPLE_RATE });
      }
    }
    if (audioCtxRef.current?.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    return stream;
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const newState = !prev;
      isMutedRef.current = newState;
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach((t) => (t.enabled = !newState));
      }
      playMutedSound(newState);
      return newState;
    });
  }, []);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch {}
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    userAnalyserRef.current = null;
    modelAnalyserRef.current = null;
    sessionReadyRef.current = false;
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      try { audioCtxRef.current.close(); } catch {}
    }
    audioCtxRef.current = null;
    nextStartTimeRef.current = 0;
    audioSourcesRef.current = [];
    connectAbortRef.current?.abort();
    connectAbortRef.current = null;
  }, []);

  const stopAllPlayback = useCallback(() => {
    audioSourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
    audioSourcesRef.current = [];
    if (audioCtxRef.current) nextStartTimeRef.current = audioCtxRef.current.currentTime;
  }, []);

  const updateTranscript = (role: 'user' | 'model', text: string, final: boolean) => {
    setTranscripts((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && !last.final) {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...last,
          text: final ? text : last.text + text,
          timestamp: Date.now(),
          final,
        };
        return updated;
      }
      return [...prev, { id: Math.random().toString(36), role, text, timestamp: Date.now(), final }];
    });
  };

  const startAudioCapture = useCallback(async (existingStream?: MediaStream) => {
    try {
      const audioCtx = audioCtxRef.current ?? new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: LIVE_OUTPUT_SAMPLE_RATE });
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      const stream = existingStream ?? await requestMicrophoneAccess();
      streamRef.current = stream;

      const source = audioCtx.createMediaStreamSource(stream);
      const userAnalyser = audioCtx.createAnalyser();
      userAnalyser.fftSize = 256;
      userAnalyserRef.current = userAnalyser;
      source.connect(userAnalyser);

      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;
      source.connect(processor);
      processor.connect(audioCtx.destination);

      const dataArray = new Uint8Array(userAnalyser.frequencyBinCount);
      processor.onaudioprocess = (e) => {
        userAnalyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((p, c) => p + c, 0) / dataArray.length;
        const vol = avg / 160;
        setUserVolume(vol);

        if (vol > 0.12 && modelVolumeRef.current > 0.03) {
          stopAllPlayback();
        }

        if (isMutedRef.current) return;
        if (!sessionReadyRef.current) return;
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const base64 = pcmToBase64(inputData, audioCtx.sampleRate, LIVE_INPUT_SAMPLE_RATE);
        wsRef.current.send(JSON.stringify({ audio: base64 }));
      };

      const modelAnalyser = audioCtx.createAnalyser();
      modelAnalyser.fftSize = 256;
      modelAnalyserRef.current = modelAnalyser;
      modelAnalyser.connect(audioCtx.destination);
    } catch (err: any) {
      setError(`Microphone access error: ${err.message}`);
      setStatus('error');
    }
  }, [requestMicrophoneAccess, stopAllPlayback]);

  const playAudioChunk = useCallback((base64: string) => {
    if (!audioCtxRef.current || !modelAnalyserRef.current) return;
    const audioCtx = audioCtxRef.current;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const data = base64ToFloat32(base64);
    const buffer = audioCtx.createBuffer(1, data.length, LIVE_OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(data);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(modelAnalyserRef.current);

    const now = audioCtx.currentTime;
    // Larger jitter buffer (~140ms lead-in) — eliminates audio breakup on flaky links.
    const safety = 0.14;
    if (nextStartTimeRef.current < now + safety) nextStartTimeRef.current = now + safety;
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += buffer.duration;

    audioSourcesRef.current.push(source);
    source.onended = () => {
      audioSourcesRef.current = audioSourcesRef.current.filter((s) => s !== source);
    };

    const modelData = new Uint8Array(modelAnalyserRef.current.frequencyBinCount);
    const tick = () => {
      if (!modelAnalyserRef.current) return;
      modelAnalyserRef.current.getByteFrequencyData(modelData);
      const avg = modelData.reduce((p, c) => p + c, 0) / modelData.length;
      const v = avg / 140;
      modelVolumeRef.current = v;
      setModelVolume(v);
      if (avg > 0) requestAnimationFrame(tick);
      else { modelVolumeRef.current = 0; setModelVolume(0); }
    };
    tick();
  }, []);

  const connect = useCallback(
    async (config: { systemInstruction: string; voiceName: string; onTerminationTriggered?: () => void; stream?: MediaStream }) => {
      setTranscripts([]);
      setError(null);
      setUserVolume(0);
      setModelVolume(0);
      setStatus('connecting');
      shouldReconnectRef.current = true;
      const connectAbort = new AbortController();
      connectAbortRef.current = connectAbort;
      if (config.stream) {
        streamRef.current = config.stream;
      }

      // Get JWT for auth via query param (WebSocket can't set headers in browsers)
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token;
      if (!token) {
        setError('Not authenticated');
        setStatus('error');
        return;
      }

      const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const wsUrl = SUPABASE_URL.replace(/^http/, 'ws') + `/functions/v1/gemini-live-proxy?token=${encodeURIComponent(token)}&apikey=${encodeURIComponent(apikey)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const connectTimeout = window.setTimeout(() => {
        if (connectAbort.signal.aborted) return;
        setError('Voice call timed out while connecting.');
        setStatus('error');
        try { ws.close(); } catch {}
      }, 12000);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'setup',
          systemInstruction: config.systemInstruction,
          voiceName: config.voiceName,
        }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'connected') {
          window.clearTimeout(connectTimeout);
          sessionReadyRef.current = true;
          setStatus('connected');
          startAudioCapture(config.stream);
          playInitiatedSound();
          return;
        }
        if (msg.type === 'error') {
          window.clearTimeout(connectTimeout);
          sessionReadyRef.current = false;
          console.error('Gemini Live Error:', msg.message);
          setError(msg.message);
          setStatus('error');
          return;
        }

        // Audio
        const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (audioData) playAudioChunk(audioData);

        if (msg.serverContent?.interrupted) stopAllPlayback();

        // Transcriptions
        const modelText = msg.serverContent?.outputTranscription?.text || msg.serverContent?.modelTurn?.parts?.[0]?.text;
        if (modelText) {
          updateTranscript('model', modelText, !!msg.serverContent?.outputTranscription);
          const lower = modelText.toLowerCase();
          if (
            config.onTerminationTriggered &&
            (lower.includes('goodbye') || lower.includes('terminating') || lower.includes('session ended') ||
             lower.includes('odabo') || lower.includes('oda bo') || lower.includes('adios') || lower.includes('au revoir'))
          ) {
            config.onTerminationTriggered();
          }
        }
        const userText = msg.serverContent?.inputTranscription?.text;
        if (userText) {
          updateTranscript('user', userText, true);
          if (config.onTerminationTriggered && detectTerminationIntent(userText)) {
            config.onTerminationTriggered();
          }
        }
      };

      ws.onclose = () => {
        window.clearTimeout(connectTimeout);
        sessionReadyRef.current = false;
        if (!shouldReconnectRef.current) return;
        if (status !== 'connected') {
          setError((prev) => prev || 'Voice call disconnected before it became active.');
          setStatus('error');
        } else {
          setStatus('idle');
        }
        cleanup();
      };

      ws.onerror = (err) => {
        window.clearTimeout(connectTimeout);
        sessionReadyRef.current = false;
        console.error('WebSocket error:', err);
        setError('Connection error');
        setStatus('error');
      };
    },
    [cleanup, startAudioCapture, playAudioChunk, status, stopAllPlayback]
  );

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    cleanup();
    setStatus('idle');
  }, [cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);

  return { status, transcripts, isMuted, toggleMute, userVolume, modelVolume, error, connect, disconnect, requestMicrophoneAccess };
}
