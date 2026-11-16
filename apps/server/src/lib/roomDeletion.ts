import fs from 'node:fs/promises';
import path from 'node:path';
import { tryResourceLock } from './resourceLimits.js';
import type { FastifyBaseLogger } from 'fastify';
import type { Server } from 'socket.io';
import { prisma } from './prisma.js';
import { removeRoomUploads, UPLOADS_ROOT } from './uploads.js';
import { evictRoom, getRoomPeersSnapshot } from '../socket/handler.js';
import { sweepModerationEvents } from './moderation/index.js';

/** Intervalo da varredura de salas temporárias vencidas. */
export const ROOM_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Exclusão definitiva de uma sala — a MESMA usada pelo DELETE do dono/admin e
 * pela varredura de vencidas:
 * 1) avisa e tira todo mundo (antes de sumir com o banco, para nenhum peer
 *    continuar sinalizando numa sala inexistente);
 * 2) marcador duravel e sala ENDED impedem novas operacoes;
 * 3) disco antes do banco, transacao de metadados e remocao do marcador.
 * Falha e retomada pelo GC inicial/diario, sem perder a referencia no banco.
 */
export async function purgeRoom(
  io: Server | undefined,
  roomId: string,
  log?: Pick<FastifyBaseLogger, 'error'>,
): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(roomId)) throw new Error('Invalid roomId');
  const release = tryResourceLock(`room:${roomId}`);
  if (!release) throw Object.assign(new Error('Room upload/deletion in progress. Try again.'), { statusCode: 409 });
  const marker = path.join(UPLOADS_ROOT, '.room-deletions', roomId);
  try {
    await fs.mkdir(path.dirname(marker), { recursive: true });
    // Marcar antes de mudar o banco permite retomar inclusive apos crash.
    const handle = await fs.open(marker, 'w', 0o600);
    try { await handle.sync(); } finally { await handle.close(); }
    // fsync de diretorio so existe em POSIX; no Windows (dev/start.bat) abrir
    // ou sincronizar uma pasta da EPERM/EISDIR e o marcador ja esta gravado.
    if (process.platform !== 'win32') {
      const markerDirectory = await fs.open(path.dirname(marker), 'r');
      try { await markerDirectory.sync(); } finally { await markerDirectory.close(); }
    }
    await prisma.room.updateMany({ where: { id: roomId }, data: { status: 'ENDED' } });
    evictRoom(io, roomId);
    // Nao perde referencias se a remocao falhar: sala fica ENDED e marcada.
    await removeRoomUploads(roomId);
    await prisma.$transaction([
      prisma.chatFile.deleteMany({ where: { roomId } }),
      prisma.chatMessage.deleteMany({ where: { roomId } }),
      prisma.roomMember.deleteMany({ where: { roomId } }),
      prisma.room.deleteMany({ where: { id: roomId } }),
    ]);
    await fs.unlink(marker);
  } catch (err) {
    log?.error({ err, roomId }, 'room purge: pending retry');
    throw err;
  } finally { release(); }
}

/** Marcadores no mesmo volume dos anexos sobrevivem a reinicio do container. */
export async function retryPendingRoomDeletions(io: Server | undefined, log?: Pick<FastifyBaseLogger, 'error'>): Promise<void> {
  let entries;
  try { entries = await fs.opendir(path.join(UPLOADS_ROOT, '.room-deletions')); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for await (const entry of entries) {
    if (!entry.isFile()) continue;
    await purgeRoom(io, entry.name, log).catch(() => {});
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

  // Retencao dos eventos de moderacao (LGPD, MODERATION_RETENTION_DAYS): pega
  // carona no mesmo timer. Falha aqui nao pode travar a varredura de salas.
  try {
    const removed = await sweepModerationEvents({ now });
    if (removed > 0) opts.log?.info({ count: removed }, 'moderation sweep: expired events deleted');
  } catch (err) {
    opts.log?.error({ err }, 'moderation sweep: failed');
  }
  return result;
}
