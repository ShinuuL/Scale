'use client';

import { useEffect, useRef, useState } from 'react';

/** Volume RMS (0..1) acima do qual a pessoa conta como "falando". */
const SPEAKING_THRESHOLD = 0.035;
/** Quanto o indicador segura depois do último pico — evita piscar entre sílabas. */
const SPEAKING_HOLD_MS = 350;
const SAMPLE_INTERVAL_MS = 100;

export interface SpeakingSource {
  id: string;
  stream: MediaStream | null;
}

/**
 * Ids de quem está falando agora (anel verde do canal de voz). Um único
 * AudioContext para todas as streams; o analisador só LÊ a faixa (não toca
 * nada — a reprodução continua nos `<audio>`). Só re-renderiza quando o
 * conjunto muda.
 */
export function useSpeaking(sources: SpeakingSource[]): Set<string> {
  const [speaking, setSpeaking] = useState<Set<string>>(() => new Set());
  // Chave estável: só recria os analisadores quando a faixa de áudio muda.
  const key = sources
    .map((s) => `${s.id}:${s.stream?.getAudioTracks()[0]?.id ?? '-'}`)
    .join('|');
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return;
    const withAudio = sourcesRef.current.filter((s) => (s.stream?.getAudioTracks().length ?? 0) > 0);
    if (withAudio.length === 0) {
      setSpeaking((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    const ctx = new AudioContext();
    const buffer = new Float32Array(512);
    const meters = withAudio.map((s) => {
      const source = ctx.createMediaStreamSource(s.stream as MediaStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      return { id: s.id, analyser, lastPeak: 0 };
    });

    // Sem gesto do usuário o contexto nasce suspenso; tenta retomar no 1º gesto.
    const resume = () => void ctx.resume().catch(() => {});
    resume();
    window.addEventListener('pointerdown', resume, true);

    const timer = window.setInterval(() => {
      const now = Date.now();
      const next = new Set<string>();
      for (const m of meters) {
        m.analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
        if (Math.sqrt(sum / buffer.length) > SPEAKING_THRESHOLD) m.lastPeak = now;
        if (now - m.lastPeak < SPEAKING_HOLD_MS) next.add(m.id);
      }
      setSpeaking((prev) =>
        prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next,
      );
    }, SAMPLE_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', resume, true);
      void ctx.close().catch(() => {});
    };
  }, [key]);

  return speaking;
}
