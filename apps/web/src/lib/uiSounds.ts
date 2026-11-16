/**
 * Sons curtos de feedback da chamada (mute, desmute, partilha de tela),
 * sintetizados com Web Audio: sem arquivo, sem rede. Falha silenciosa quando
 * o navegador bloqueia áudio ou não há AudioContext (testes/SSR).
 */
export type UiSound = 'mute' | 'unmute' | 'screen-on' | 'screen-off';

/** Sequência de notas: [frequência Hz, início s, duração s]. */
const PATTERNS: Record<UiSound, [number, number, number][]> = {
  mute: [
    [660, 0, 0.09],
    [440, 0.09, 0.12],
  ],
  unmute: [
    [440, 0, 0.09],
    [660, 0.09, 0.12],
  ],
  'screen-on': [
    [523, 0, 0.08],
    [659, 0.08, 0.08],
    [784, 0.16, 0.14],
  ],
  'screen-off': [
    [784, 0, 0.08],
    [659, 0.08, 0.08],
    [523, 0.16, 0.14],
  ],
};

const VOLUME = 0.12;
let shared: AudioContext | null = null;

export function playUiSound(sound: UiSound): void {
  try {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return;
    shared ??= new AudioContext();
    const ctx = shared;
    void ctx.resume().catch(() => {});
    const base = ctx.currentTime + 0.02;
    for (const [frequency, offset, duration] of PATTERNS[sound]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = base + offset;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(VOLUME, at + 0.015);
      gain.gain.linearRampToValueAtTime(0, at + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + duration + 0.02);
    }
  } catch {
    // Sem áudio disponível: o estado visual continua sendo o feedback.
  }
}
