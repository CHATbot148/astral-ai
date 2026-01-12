import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Lightweight mic level meter for UI-only visualizations.
 * - Starts/stops the mic stream
 * - Produces N bar levels in [0..1]
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
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;

        const source = ctx.createMediaStreamSource(stream);
        sourceRef.current = source;
        source.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);

        const loop = () => {
          analyser.getByteTimeDomainData(data);
          // RMS level [0..1]
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);

          // Create a pleasing bar distribution from RMS.
          // We bias the middle bars a bit higher.
          const next = Array.from({ length: barCount }, (_, i) => {
            const midBias = 1 - Math.abs(i - (barCount - 1) / 2) / ((barCount - 1) / 2);
            const target = rms * (0.55 + midBias * 0.75);
            return Math.max(0.02, Math.min(1, target));
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
