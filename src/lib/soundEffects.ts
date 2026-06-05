// Elegant Web-Synthesized Sound Effects for Astraz Voice
// Avoids external assets, loading delays, and assets missing on deployment.

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      sharedAudioCtx = new AudioContextClass();
    }
  }
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

/**
 * Ascending sweet melodic chime when call session is successfully initiated.
 * Note chain: E5 (659Hz) -> A5 (880Hz) -> B5 (987Hz)
 */
export function playInitiatedSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  
  const notes = [659.25, 880.00, 987.77];
  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    // Smooth triangle wave for absolute warmth
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + idx * 0.12);
    
    gain.gain.setValueAtTime(0, now + idx * 0.12);
    gain.gain.linearRampToValueAtTime(0.06, now + idx * 0.12 + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.45);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(now + idx * 0.12);
    osc.stop(now + idx * 0.12 + 0.5);
  });
}

/**
 * Toggling soft chime when the microphone mute state changes.
 * Descending warm low tone for muted, ascending soft bubble tone for unmuted.
 */
export function playMutedSound(isCurrentlyMuted: boolean) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  
  const freqs = isCurrentlyMuted ? [440.00, 311.13] : [311.13, 523.25];
  freqs.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + idx * 0.08);
    
    gain.gain.setValueAtTime(0, now + idx * 0.08);
    // Darker, softer volumes to avoid irritation during active session
    gain.gain.linearRampToValueAtTime(0.04, now + idx * 0.08 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.25);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(now + idx * 0.08);
    osc.stop(now + idx * 0.08 + 0.3);
  });
}

/**
 * Peaceful, descending organic sound when session is terminated (G4 -> D4 -> A3).
 */
export function playEndedSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  
  const notes = [392.00, 293.66, 220.00];
  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + idx * 0.15);
    
    gain.gain.setValueAtTime(0, now + idx * 0.15);
    gain.gain.linearRampToValueAtTime(0.05, now + idx * 0.15 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.15 + 0.6);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(now + idx * 0.15);
    osc.stop(now + idx * 0.15 + 0.7);
  });
}
