import { useEffect, useState, useRef } from 'react';

/**
 * Typewriter effect — reveals text one character at a time.
 * Returns { displayed, done }. Cursor is up to the consumer to render.
 */
export function useTypewriter(text: string, speedMs = 35, enabled = true) {
  const [displayed, setDisplayed] = useState(enabled ? '' : text);
  const [done, setDone] = useState(!enabled);
  const indexRef = useRef(0);
  const textRef = useRef(text);

  useEffect(() => {
    textRef.current = text;
    if (!enabled) {
      setDisplayed(text);
      setDone(true);
      return;
    }
    setDisplayed('');
    setDone(false);
    indexRef.current = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const i = indexRef.current;
      if (i >= textRef.current.length) {
        setDone(true);
        return;
      }
      indexRef.current = i + 1;
      setDisplayed(textRef.current.slice(0, indexRef.current));
      window.setTimeout(tick, speedMs);
    };
    window.setTimeout(tick, speedMs);
    return () => {
      cancelled = true;
    };
  }, [text, speedMs, enabled]);

  return { displayed, done };
}
