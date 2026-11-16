'use client';

import { useEffect, useRef } from 'react';
import { MODERATION_FRAME_MAX_BYTES, MODERATION_FRAME_MAX_WIDTH } from '@scale/shared';
import { api } from '@/lib/api';

export interface UseScreenModerationOptions {
  roomId: string;
  /** Captura local da tela (null = nao esta compartilhando). */
  stream: MediaStream | null;
  /** `config.screen` do servidor: amostragem ligada (provedor com imagem). */
  enabled: boolean;
  /** `config.frameIntervalSec` (10..120). */
  intervalSec: number;
  /** Room ticket (header `X-Room-Ticket`); sem ele nada e enviado. */
  ticket: string | null;
}

/** Qualidade JPEG das amostras: baixa de proposito (classificacao, nao exibicao). */
export const MODERATION_FRAME_JPEG_QUALITY = 0.6;

/**
 * Amostragem de tela para o assistente de moderacao (spec 4.2): enquanto o
 * PROPRIO cliente compartilha e a amostragem esta ligada no servidor, desenha
 * o video da captura num canvas pequeno (largura <= MODERATION_FRAME_MAX_WIDTH),
 * gera um JPEG e envia a cada `intervalSec`. Para sozinho ao parar de
 * compartilhar. Erros sao silenciosos (log de debug): a partilha nunca cai por
 * causa da amostragem. O veredito chega por socket (`moderation:action`).
 */
export function useScreenModeration({ roomId, stream, enabled, intervalSec, ticket }: UseScreenModerationOptions): void {
  // Evita duas amostras em voo quando o envio demora mais que o intervalo.
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!stream || !enabled || !ticket || !roomId) return;
    if (typeof document === 'undefined') return;
    const intervalMs = Math.max(1, intervalSec) * 1000;

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      const played = video.play();
      if (played && typeof played.catch === 'function') played.catch(() => undefined);
    } catch {
      // jsdom / navegadores sem autoplay: o frame sai do tamanho da faixa.
    }
    const canvas = document.createElement('canvas');
    let cancelled = false;

    const sample = (): void => {
      if (cancelled || inFlightRef.current) return;
      const settings = stream.getVideoTracks()[0]?.getSettings?.();
      const srcW = video.videoWidth || settings?.width || 640;
      const srcH = video.videoHeight || settings?.height || 360;
      const scale = Math.min(1, MODERATION_FRAME_MAX_WIDTH / srcW);
      canvas.width = Math.max(1, Math.round(srcW * scale));
      canvas.height = Math.max(1, Math.round(srcH * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } catch (error) {
        console.debug('[Moderation] drawImage falhou', error);
        return;
      }
      inFlightRef.current = true;
      canvas.toBlob(
        (blob) => {
          if (cancelled || !blob || blob.size === 0 || blob.size > MODERATION_FRAME_MAX_BYTES) {
            inFlightRef.current = false;
            return;
          }
          api
            .sendModerationFrame(roomId, blob, ticket)
            .catch((error: unknown) => console.debug('[Moderation] amostra recusada', error))
            .finally(() => {
              inFlightRef.current = false;
            });
        },
        'image/jpeg',
        MODERATION_FRAME_JPEG_QUALITY,
      );
    };

    const timer = window.setInterval(sample, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      inFlightRef.current = false;
      video.pause?.();
      video.srcObject = null;
    };
  }, [roomId, stream, enabled, intervalSec, ticket]);
}
