import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Lightweight mic level meter for UI-only visualizations.
 * - Starts/stops the mic stream
 * - Produces N bar levels in [0..1]
 * - More sensitive to show higher frequencies even with low sound levels
 */
export function useMicVisualizer({
  enabled,
  bars = 12,
}: {
  enabled: boolean;
  bars?: number;
}) {
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: bars }, () => 0));
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const barCount = useMemo(() => Math.max(4, Math.min(32, bars)), [bars]);

  useEffect(() => {
    setLevels(Array.from({ length: barCount }, () => 0));
  }, [barCount]);

  useEffect(() => {
    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;

      try {
        sourceRef.current?.disconnect();
      } catch {
        /* noop */
      }

      try {
        analyserRef.current?.disconnect();
      } catch {
        /* noop */
      }

      sourceRef.current = null;
      analyserRef.current = null;

      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) t.stop();
      }
      streamRef.current = null;

      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close().catch(() => undefined);
      }
      audioCtxRef.current = null;

      setLevels(Array.from({ length: barCount }, () => 0));
    };

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256; // Smaller for faster response
        analyser.smoothingTimeConstant = 0.3; // Less smoothing = more responsive
        analyserRef.current = analyser;

        const source = ctx.createMediaStreamSource(stream);
        sourceRef.current = source;
        source.connect(analyser);

        const freqData = new Uint8Array(analyser.frequencyBinCount);

        const loop = () => {
          analyser.getByteFrequencyData(freqData);
          
          // Use frequency data instead of time domain for more visual response
          // This shows activity even at low volumes
          const binSize = Math.floor(freqData.length / barCount);
          
          const next = Array.from({ length: barCount }, (_, i) => {
            // Get average of frequency bins for this bar
            let sum = 0;
            const startBin = i * binSize;
            const endBin = Math.min(startBin + binSize, freqData.length);
            
            for (let j = startBin; j < endBin; j++) {
              sum += freqData[j];
            }
            
            const avg = sum / (endBin - startBin);
            // Normalize to 0-1 with boosted sensitivity
            // Apply a power curve to make low levels more visible
            const normalized = Math.pow(avg / 255, 0.6);
            
            // Add minimum threshold for visual feedback
            const boosted = Math.max(0.05, normalized * 1.5);
            
            return Math.min(1, boosted);
          });

          setLevels(next);
          rafRef.current = requestAnimationFrame(loop);
        };

        loop();
      } catch {
        stop();
      }
    };

    if (enabled) start();
    else stop();

    return stop;
  }, [enabled, barCount]);

  return { levels, bars: barCount };
}