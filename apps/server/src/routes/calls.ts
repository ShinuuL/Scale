import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  CALL_RING_TIMEOUT_MS,
  MAX_PARTICIPANTS,
  ROOM_NAME_MAX,
  startCallSchema,
  type CallEndReason,
  type CallInvite,
  type PublicUser,
} from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { isCallRateLimited } from '../lib/rateLimit.js';
import { getRoomPeerCount, isUserInRoom, userRoom } from '../socket/handler.js';
import { isRoomOpen } from '../lib/roomAccess.js';
import { areFriends, publicUserSelect, toPublicUser } from './social.js';

/**
 * Ligacao entre amigos (ver @scale/shared calls.ts).
 *
 * Quem liga ganha uma sala privada temporaria (dono = quem liga, 1 h) e entra
 * nela na hora; o amigo recebe `call:incoming` com o convite da sala e a tela
 * de chamada toca. A chamada pendente fica so na memoria: reiniciar o servidor
 * derruba o toque, e a sala continua valendo como uma sala comum.
 */

interface PendingCall {
  id: string;
  roomId: string;
  inviteToken: string;
  /** Sala ja existente (adicionar na chamada); null = sala nova da ligacao. */
  roomName: string | null;
  caller: PublicUser;
  callee: PublicUser;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingCall>();

/** Sala temporaria criada para a ligacao. */
const CALL_ROOM_TTL_MS = 60 * 60_000;

const callIdParams = z.object({ id: z.string().uuid() });

function ioOf(fastify: FastifyInstance): Server | undefined {
  return (fastify as unknown as { io?: Server }).io;
}

/** Visao da chamada para um dos lados: `peer` e sempre a outra pessoa. */
function inviteFor(call: PendingCall, side: 'caller' | 'callee'): CallInvite {
  return {
    callId: call.id,
    roomId: call.roomId,
    // So quem recebe precisa do convite (quem liga e o dono da sala).
    inviteToken: side === 'callee' ? call.inviteToken : undefined,
    peer: side === 'callee' ? call.caller : call.callee,
    roomName: call.roomName ?? undefined,
    expiresAt: new Date(call.expiresAt).toISOString(),
  };
}

function endCall(fastify: FastifyInstance, call: PendingCall, reason: CallEndReason): void {
  clearTimeout(call.timer);
  pending.delete(call.id);
  const io = ioOf(fastify);
  if (!io) return;
  const payload = { callId: call.id, reason };
  io.to(userRoom(call.caller.id)).emit('call:ended', payload);
  io.to(userRoom(call.callee.id)).emit('call:ended', payload);
}

function sessionUser(request: FastifyRequest, reply: FastifyReply): string | null {
  if (!request.userId) {
    void reply.code(401).send({ error: 'Not authenticated' });
    return null;
  }
  return request.userId;
}

/** Para os testes: derruba todas as chamadas pendentes (sem eventos). */
export function resetPendingCalls(): void {
  for (const call of pending.values()) clearTimeout(call.timer);
  pending.clear();
}

export async function callRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [fastify.authenticate as never] };

  // POST /api/calls — liga para um amigo.
  fastify.post('/api/calls', auth, async (request, reply) => {
    const me = sessionUser(request, reply);
    if (!me) return reply;

    const parsed = startCallSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    }
    const { friendId, roomId } = parsed.data;
    if (friendId === me) return reply.code(400).send({ error: 'Cannot call yourself' });

    const limit = isCallRateLimited(me);
    if (limit.limited) {
      return reply
        .code(429)
        .header('Retry-After', String(Math.max(1, limit.retryAfterSeconds)))
        .send({ error: 'Too many calls. Try again later.' });
    }

    if (!(await areFriends(me, friendId))) return reply.code(403).send({ error: 'Not friends' });

    const [callerRow, calleeRow] = await Promise.all([
      prisma.user.findUnique({ where: { id: me }, select: publicUserSelect }),
      prisma.user.findUnique({ where: { id: friendId }, select: publicUserSelect }),
    ]);
    if (!callerRow || !calleeRow) return reply.code(404).send({ error: 'User not found' });
    const caller = toPublicUser(callerRow);
    const callee = toPublicUser(calleeRow);

    // Adicionar na chamada: so quem esta AGORA na sala chama alguem para ela,
    // e a sala precisa estar aberta e com vaga. O convite vai so para o amigo
    // (participante que nao e dono nunca ve o convite na tela).
    let room: { id: string; inviteToken: string };
    let roomName: string | null = null;
    if (roomId) {
      const existing = await prisma.room.findUnique({
        where: { id: roomId },
        select: { id: true, name: true, inviteToken: true, ownerId: true, status: true, expiresAt: true, maxParticipants: true },
      });
      if (!existing || !isRoomOpen(existing) || !isUserInRoom(roomId, me)) {
        return reply.code(403).send({ error: 'Not in room' });
      }
      if (isUserInRoom(roomId, friendId)) return reply.code(409).send({ error: 'Already in room' });
      if (getRoomPeerCount(roomId) >= Math.min(existing.maxParticipants, MAX_PARTICIPANTS)) {
        return reply.code(409).send({ error: 'Room is full' });
      }
      room = existing;
      roomName = existing.name;
    } else {
      room = await prisma.room.create({
        data: {
          name: `Chamada de ${caller.name}`.slice(0, ROOM_NAME_MAX),
          isPersistent: false,
          isPrivate: true,
          maxParticipants: MAX_PARTICIPANTS,
          inviteToken: uuidv4(),
          expiresAt: new Date(Date.now() + CALL_ROOM_TTL_MS),
          ownerId: me,
        },
        select: { id: true, inviteToken: true },
      });
    }

    // Ligar de novo para a mesma pessoa substitui o toque anterior.
    for (const old of pending.values()) {
      if (old.caller.id === me && old.callee.id === friendId) endCall(fastify, old, 'cancelled');
    }

    const call: PendingCall = {
      id: uuidv4(),
      roomId: room.id,
      inviteToken: room.inviteToken,
      roomName,
      caller,
      callee,
      expiresAt: Date.now() + CALL_RING_TIMEOUT_MS,
      timer: setTimeout(() => {
        const still = pending.get(call.id);
        if (still) endCall(fastify, still, 'missed');
      }, CALL_RING_TIMEOUT_MS),
    };
    call.timer.unref();
    pending.set(call.id, call);

    const io = ioOf(fastify);
    io?.to(userRoom(callee.id)).emit('call:incoming', inviteFor(call, 'callee'));
    io?.to(userRoom(caller.id)).emit('call:outgoing', inviteFor(call, 'caller'));

    return reply.code(201).send({
      callId: call.id,
      roomId: call.roomId,
      expiresAt: new Date(call.expiresAt).toISOString(),
    });
  });

  // GET /api/calls — chamadas tocando agora (a tela recupera apos recarregar).
  fastify.get('/api/calls', auth, async (request, reply) => {
    const me = sessionUser(request, reply);
    if (!me) return reply;
    const incoming: CallInvite[] = [];
    const outgoing: CallInvite[] = [];
    for (const call of pending.values()) {
      if (call.callee.id === me) incoming.push(inviteFor(call, 'callee'));
      if (call.caller.id === me) outgoing.push(inviteFor(call, 'caller'));
    }
    return reply.send({ incoming, outgoing });
  });

  /** Acha a chamada em que `me` e o lado `side`; 404 igual para "nao existe" e "nao e sua". */
  function findCall(request: FastifyRequest, reply: FastifyReply, me: string, side: 'caller' | 'callee') {
    const params = callIdParams.safeParse(request.params);
    const call = params.success ? pending.get(params.data.id) : undefined;
    if (!call || call[side].id !== me) {
      void reply.code(404).send({ error: 'Call not found' });
      return null;
    }
    return call;
  }

  // POST /api/calls/:id/accept — quem recebe atende; devolve o convite da sala.
  fastify.post('/api/calls/:id/accept', auth, async (request, reply) => {
    const me = sessionUser(request, reply);
    if (!me) return reply;
    const call = findCall(request, reply, me, 'callee');
    if (!call) return reply;
    endCall(fastify, call, 'accepted');
    return reply.send({ roomId: call.roomId, inviteToken: call.inviteToken });
  });

  // POST /api/calls/:id/decline — quem recebe recusa.
  fastify.post('/api/calls/:id/decline', auth, async (request, reply) => {
    const me = sessionUser(request, reply);
    if (!me) return reply;
    const call = findCall(request, reply, me, 'callee');
    if (!call) return reply;
    endCall(fastify, call, 'declined');
    return reply.send({ success: true });
  });

  // POST /api/calls/:id/cancel — quem ligou desiste.
  fastify.post('/api/calls/:id/cancel', auth, async (request, reply) => {
    const me = sessionUser(request, reply);
    if (!me) return reply;
    const call = findCall(request, reply, me, 'caller');
    if (!call) return reply;
    endCall(fastify, call, 'cancelled');
    return reply.send({ success: true });
  });
}
