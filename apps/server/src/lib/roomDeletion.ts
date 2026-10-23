import type { FastifyBaseLogger } from 'fastify';
import type { Server } from 'socket.io';
import { prisma } from './prisma.js';
import { removeRoomUploads } from './uploads.js';
import { evictRoom, getRoomPeersSnapshot } from '../socket/handler.js';

/** Intervalo da varredura de salas temporárias vencidas. */
export const ROOM_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Exclusão definitiva de uma sala — a MESMA usada pelo DELETE do dono/admin e
 * pela varredura de vencidas:
 * 1) avisa e tira todo mundo (antes de sumir com o banco, para nenhum peer
 *    continuar sinalizando numa sala inexistente);
 * 2) banco numa transação (o schema já tem onDelete: Cascade, mas apagar
 *    explicitamente não depende do PRAGMA foreign_keys);
 * 3) disco em best-effort: falhar aqui não desfaz a exclusão.
 */
export async function purgeRoom(
  io: Server | undefined,
  roomId: string,
  log?: Pick<FastifyBaseLogger, 'error'>,
): Promise<void> {
  evictRoom(io, roomId);

  await prisma.$transaction([
    prisma.chatFile.deleteMany({ where: { roomId } }),
    prisma.chatMessage.deleteMany({ where: { roomId } }),
    prisma.roomMember.deleteMany({ where: { roomId } }),
    prisma.room.delete({ where: { id: roomId } }),
  ]);

  try {
    await removeRoomUploads(roomId);
  } catch (err) {
    log?.error({ err, roomId }, 'room purge: failed to remove uploads dir');
  }
}

export interface SweepResult {
  deleted: string[];
  /** Vencidas com gente conectada: ficam para a próxima rodada. */
  skippedBusy: string[];
}

/**
 * Apaga as salas TEMPORÁRIAS cujo prazo (expiresAt) já passou. Antes nada
 * encerrava uma temporária vencida: o auto-delete só existia como timer em
 * memória após a sala esvaziar, e se perdia a cada reinício — elas ficavam no
 * banco como ACTIVE para sempre.
 *
 * Sala vencida com gente conectada NÃO é apagada (não derruba uma chamada em
 * andamento); sai na rodada seguinte, depois que todos saírem. A entrada de
 * novos participantes em sala vencida já é recusada pelo join-room.
 */
export async function sweepExpiredRooms(opts: {
  io: Server | undefined;
  now?: Date;
  /** Para testes; padrão = salas com peers conectados agora. */
  activeRoomIds?: Set<string>;
  log?: Pick<FastifyBaseLogger, 'error' | 'info'>;
}): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const active = opts.activeRoomIds ?? new Set(getRoomPeersSnapshot().keys());

  const expired = await prisma.room.findMany({
    where: { isPersistent: false, expiresAt: { lt: now } },
    select: { id: true },
  });

  const result: SweepResult = { deleted: [], skippedBusy: [] };
  for (const { id } of expired) {
    if (active.has(id)) {
      result.skippedBusy.push(id);
      continue;
    }
    try {
      await purgeRoom(opts.io, id, opts.log);
      result.deleted.push(id);
    } catch (err) {
      // Uma sala com problema não pode travar a varredura das demais.
      opts.log?.error({ err, roomId: id }, 'room sweep: failed to purge room');
    }
  }

  if (result.deleted.length > 0) {
    opts.log?.info({ count: result.deleted.length }, 'room sweep: expired temporary rooms deleted');
  }
  return result;
}
