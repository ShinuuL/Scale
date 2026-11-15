import { z } from 'zod';

/* ─── Fase 4: eventos agendados da comunidade ─────────── */

export const COMMUNITY_EVENT_TITLE_MAX = 100;
export const COMMUNITY_EVENT_DESCRIPTION_MAX = 1000;
/** Janela do selo "proximos eventos" no cabecalho. */
export const COMMUNITY_EVENT_SOON_MS = 24 * 60 * 60 * 1000;
/** Teto de eventos futuros por comunidade (freia spam de agenda). */
export const MAX_UPCOMING_COMMUNITY_EVENTS = 50;

const isoDate = z.string().datetime({ offset: true });

/** Criar/editar: inicio no futuro e fim (opcional) depois do inicio. */
export const communityEventInputSchema = z
  .object({
    title: z.string().trim().min(1).max(COMMUNITY_EVENT_TITLE_MAX),
    description: z.string().trim().max(COMMUNITY_EVENT_DESCRIPTION_MAX).nullish().transform((v) => (v ? v : null)),
    startsAt: isoDate,
    endsAt: isoDate.nullish().transform((v) => v ?? null),
    channelId: z.string().uuid().nullish().transform((v) => v ?? null),
  })
  .refine((v) => !v.endsAt || Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: 'O fim precisa ser depois do início', path: ['endsAt'],
  });
export type CommunityEventInput = z.input<typeof communityEventInputSchema>;

export const communityEventInterestSchema = z.object({ interested: z.boolean() });

export const communityEventSchema = z.object({
  id: z.string(),
  communityId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  channelId: z.string().nullable(),
  channelName: z.string().nullable(),
  creatorName: z.string(),
  interestedCount: z.number().int().min(0),
  interested: z.boolean(),
});
export type CommunityEvent = z.infer<typeof communityEventSchema>;
export const communityEventListSchema = z.object({ events: z.array(communityEventSchema) });

/** Ainda nao terminou: fim (ou inicio, sem fim) no futuro. */
export const isEventUpcoming = (event: Pick<CommunityEvent, 'startsAt' | 'endsAt'>, now = Date.now()): boolean =>
  Date.parse(event.endsAt ?? event.startsAt) > now;
/** Quantos comecam (ou estao acontecendo) nas proximas 24 h. */
export const countEventsSoon = (events: Array<Pick<CommunityEvent, 'startsAt' | 'endsAt'>>, now = Date.now()): number =>
  events.filter((e) => isEventUpcoming(e, now) && Date.parse(e.startsAt) <= now + COMMUNITY_EVENT_SOON_MS).length;
