import type { Server as HttpServer, IncomingMessage } from 'http';
import { Server, Socket } from 'socket.io';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../lib/auth.js';
import { getAllowedOrigins, getEnv } from '../lib/env.js';
import { getSocketClientIp } from '../lib/clientIp.js';
import {
  isRateLimited,
  isChatRateLimited,
  isRoomAuthLocked,
  recordRoomAuthFailure,
  isModerationReportRateLimited,
} from '../lib/rateLimit.js';
import { computeScreenShareGate, GUEST_SCREEN_SHARE_GATE, screenShareGateSelect } from '../lib/screenShareGate.js';
import { getEffectiveMinAge } from '../lib/moderation/settings.js';
import { moderateText, recordModerationEvent } from '../lib/moderation/index.js';
import { GUEST_COOKIE_NAME, newGuestId, serializeGuestCookie, verifyGuestCookie } from '../lib/guestId.js';
import { signRoomTicket, ticketSubject } from '../lib/roomTicket.js';
import { buildIceServers } from '../lib/turnCredentials.js';
import { incChatMessages, incChatEdits, incChatDeletes } from '../lib/metrics.js';
import { emitToChannel, viewableChannel } from '../lib/channelPermissions.js';
import {
  toPublicMessage,
  isMessageAuthor,
  DELETED_MESSAGE_CONTENT,
  type ChatMessageSource,
  type MessageViewer,
  type PublicChatMessage,
} from '../lib/publicDto.js';
import {
  joinRoomSchema,
  leaveRoomSchema,
  offerSchema,
  answerSchema,
  iceCandidateSchema,
  screenShareStateSchema,
  audioStateSchema,
  voiceFlagsSchema,
  chatMessageSchema,
  chatEditSchema,
  chatDeleteSchema,
  MAX_PARTICIPANTS,
  CHAT_EDIT_WINDOW_MS,
  communitySubscriptionSchema,
  channelTypingSendSchema,
  parseGuestName,
  moderationReportSchema,
  moderationStopShareSchema,
  type ModerationActionPayload,
  type ModerationNoticePayload,
  type ModerationWarningPayload,
  type PeerInfo,
  type RoomDeletedEvent,
  type ScreenShareGate,
} from '@scale/shared';

interface SocketUser {
  userId: string | null;
  email: string | null;
  name: string;
  guestName?: string;
  /** Convidado: UUID do cookie assinado (autoria). Logado: ausente. */
  guestId?: string;
}

interface RoomPeer {
  socketId: string;
  userId: string | null;
  name: string;
  guestName?: string;
  guestId?: string;
  /** Microfone desligado ou indisponivel (informado pelo proprio cliente). */
  muted: boolean;
  /** Deafen e partilha de tela (`peer:voice-flags`): so indicadores da comunidade. */
  deafened: boolean;
  screenSharing: boolean;
}

const roomCommunities = new Map<string, string>();
const roomPeers = new Map<string, Map<string, RoomPeer>>();
/** guestId resolvido no handshake do engine, por request HTTP. */
const handshakeGuestIds = new WeakMap<IncomingMessage, string>();
const emptyTimers = new Map<string, NodeJS.Timeout>();
/**
 * Presenca: quantos sockets logados cada usuario tem (todas as abas). Online =
 * pelo menos um. So as transicoes 0->1 e 1->0 viram `community:presence`.
 */
const onlineSockets = new Map<string, number>();

export function isUserOnline(userId: string): boolean {
  return (onlineSockets.get(userId) ?? 0) > 0;
}

async function broadcastPresence(io: Server, userId: string, online: boolean): Promise<void> {
  const memberships = await prisma.communityMember.findMany({ where: { userId }, select: { communityId: true } });
  for (const { communityId } of memberships) {
    io.to(`community:${communityId}`).emit('community:presence', { communityId, userId, online });
  }
}

// MAX_PARTICIPANTS vem de @scale/shared (teto da malha, mesmo valor do cliente).
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000; // 5 minutos vazia → apaga (temporárias)

// --- Chat (Opção A) — buffer FIFO ~100 por sala temporária ---

export interface ChatMessageRow {
  id: string;
  roomId: string;
  content: string;
  authorId: string | null;
  guestName?: string;
  guestId?: string | null;
  createdAt: Date;
}

export const chatBuffers = new Map<string, Array<ChatMessageRow>>();
const CHAT_BUFFER_LIMIT = 100;

// Snapshot imutável de roomId → nº de peers conectados (para /api/metrics)
export function getRoomPeersSnapshot(): Map<string, number> {
  const snapshot = new Map<string, number>();
  for (const [roomId, peers] of roomPeers) {
    snapshot.set(roomId, peers.size);
  }
  return snapshot;
}

/**
 * Usuario logado por tras de um peer que esta AGORA na sala (null = convidado,
 * peer inexistente ou fora dela). Usado pela foto de participante da chamada:
 * o userId nunca trafega no wire, so o peerId.
 */
export function getRoomPeerUserId(roomId: string, peerId: string): string | null {
  return roomPeers.get(roomId)?.get(peerId)?.userId ?? null;
}

/** O usuario logado tem algum peer (aba) AGORA na sala? */
export function isUserInRoom(roomId: string, userId: string): boolean {
  const peers = roomPeers.get(roomId);
  if (!peers) return false;
  for (const peer of peers.values()) if (peer.userId === userId) return true;
  return false;
}

/** Quantos peers estao conectados agora na sala. */
export function getRoomPeerCount(roomId: string): number {
  return roomPeers.get(roomId)?.size ?? 0;
}

/** socket.id de um peer (aba) do usuario logado que esta AGORA na sala. */
export function findUserSocketInRoom(roomId: string, userId: string): string | null {
  const peers = roomPeers.get(roomId);
  if (!peers) return null;
  for (const peer of peers.values()) if (peer.userId === userId) return peer.socketId;
  return null;
}

/** Todas as abas do dono da sala que estao NELA agora (avisos de moderacao). */
export function getRoomOwnerSocketIds(roomId: string, ownerId: string | null): string[] {
  if (!ownerId) return [];
  const peers = roomPeers.get(roomId);
  if (!peers) return [];
  const ids: string[] = [];
  for (const peer of peers.values()) if (peer.userId === ownerId) ids.push(peer.socketId);
  return ids;
}

/** Valor de um cookie no header `Cookie` do handshake (undefined se ausente). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    if (pair.slice(0, idx).trim() !== name) continue;
    const raw = pair.slice(idx + 1).trim();
    try {
      return decodeURIComponent(raw) || undefined;
    } catch {
      return raw || undefined;
    }
  }
  return undefined;
}

/**
 * Sala pessoal do usuario logado (todas as abas dele): avisos de amizade e
 * mensagens privadas (routes/social.ts). Convidado nao entra em nenhuma.
 */
export const userRoom = (userId: string): string => `user:${userId}`;

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      // Mesma whitelist (ALLOWED_ORIGINS) usada pelo HTTP — fonte única em
      // lib/env.ts, para o WS e o REST nunca divergirem.
      origin: getAllowedOrigins(),
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // guestId do convidado (lib/guestId.ts) resolvido no PRIMEIRO response HTTP
  // do engine (polling ou upgrade do WebSocket): cookie com assinatura valida e
  // reaproveitado; ausente/adulterado gera um guestId novo e o devolve em
  // Set-Cookie no proprio handshake. Assim o cookie existe antes de qualquer
  // mensagem sem o cliente chamar nada (useSocket nao muda).
  io.engine.on('initial_headers', (headers: Record<string, string | string[]>, req: IncomingMessage) => {
    const existing = verifyGuestCookie(readCookie(req.headers.cookie, GUEST_COOKIE_NAME));
    if (existing) {
      handshakeGuestIds.set(req, existing);
      return;
    }
    const guestId = newGuestId();
    handshakeGuestIds.set(req, guestId);
    const previous = headers['set-cookie'];
    const cookie = serializeGuestCookie(guestId);
    headers['set-cookie'] = previous === undefined ? [cookie] : [...(Array.isArray(previous) ? previous : [previous]), cookie];
  });

  // Optional auth middleware
  io.use(async (socket, next) => {
    // O JWT do login vive num cookie HttpOnly (`token`), que o JS da página não
    // lê — mas o browser o envia no handshake (mesma origem via proxy/túnel).
    // Sem ler o cookie, todo usuário logado entrava como `Guest-xxxx`.
    const token =
      socket.handshake.auth?.token ??
      socket.handshake.headers?.authorization?.replace('Bearer ', '') ??
      readCookie(socket.handshake.headers?.cookie, 'token');

    // guestName vem do cliente: validado com zod (trim, 1..40, sem controle);
    // invalido ou ausente vira 'Guest' (mesma regra do upload).
    const guestName = parseGuestName(socket.handshake.auth?.guestName);
    // Cookie verificado no initial_headers; fallback: verificar aqui (ex.:
    // request sem passar pelo hook). Nunca vem do payload do cliente.
    const guestId =
      handshakeGuestIds.get(socket.request) ??
      verifyGuestCookie(readCookie(socket.handshake.headers?.cookie, GUEST_COOKIE_NAME)) ??
      undefined;

    if (token) {
      try {
        const payload = verifyToken(token);
        socket.data.user = {
          userId: payload.userId,
          email: payload.email,
          name: payload.name,
        } satisfies SocketUser;
      } catch {
        // Token invalid — allow as guest
        socket.data.user = {
          userId: null,
          email: null,
          name: guestName,
          guestName,
          guestId,
        } satisfies SocketUser;
      }
    } else {
      socket.data.user = {
        userId: null,
        email: null,
        name: guestName,
        guestName,
        guestId,
      } satisfies SocketUser;
    }
    next();
  });

  io.on('connection', (socket) => {
    const user: SocketUser = socket.data.user;
    if (user.userId) {
      const presenceUserId = user.userId;
      void socket.join(userRoom(presenceUserId));
      const count = (onlineSockets.get(presenceUserId) ?? 0) + 1;
      onlineSockets.set(presenceUserId, count);
      if (count === 1) void broadcastPresence(io, presenceUserId, true).catch(() => undefined);
      socket.on('disconnect', () => {
        const left = (onlineSockets.get(presenceUserId) ?? 1) - 1;
        if (left > 0) {
          onlineSockets.set(presenceUserId, left);
          return;
        }
        onlineSockets.delete(presenceUserId);
        void broadcastPresence(io, presenceUserId, false).catch(() => undefined);
      });
    }

    /**
     * O REMETENTE precisa estar na sala que cita no payload: sem isto um socket
     * fora da sala (ou em outra sala) que conheca um peerId mandaria
     * offer/answer/ICE para qualquer peer.
     */
    const senderInRoom = (roomId: string): boolean =>
      roomPeers.get(roomId)?.has(socket.id) === true && socket.data.roomId === roomId;

    socket.on('community:subscribe', async (data, callback) => {
      const parsed = communitySubscriptionSchema.safeParse(data);
      if (!parsed.success || !user.userId) { callback?.({ error: 'Not found' }); return; }
      const member = await prisma.communityMember.findUnique({ where: { communityId_userId: { communityId: parsed.data.communityId, userId: user.userId } } });
      if (!member) { callback?.({ error: 'Not found' }); return; }
      await socket.join(`community:${parsed.data.communityId}`);
      const voiceStates = Array.from(roomCommunities.entries())
        .filter(([channelId, communityId]) => communityId === parsed.data.communityId && (roomPeers.get(channelId)?.size ?? 0) > 0)
        .map(([channelId]) => voiceState(channelId));
      const members = await prisma.communityMember.findMany({ where: { communityId: parsed.data.communityId }, select: { userId: true } });
      const onlineUserIds = members.map((row) => row.userId).filter(isUserOnline);
      callback?.({ success: true, voiceStates, onlineUserIds });
    });
    socket.on('community:unsubscribe', (data) => {
      const parsed = communitySubscriptionSchema.safeParse(data);
      if (parsed.success) void socket.leave(`community:${parsed.data.communityId}`);
    });
    // "digitando": efemero, nao grava nada. Exige membro inscrito na comunidade
    // e canal de TEXTO dela; repassa aos outros sockets da comunidade.
    socket.on('channel:typing', async (data) => {
      if (isRateLimited(`socket:${socket.id}`) || !user.userId) return;
      const parsed = channelTypingSendSchema.safeParse(data);
      if (!parsed.success) return;
      try {
        const room = await prisma.room.findUnique({ where: { id: parsed.data.channelId }, select: { communityId: true, channelKind: true } });
        if (!room?.communityId || room.channelKind !== 'TEXT') return;
        const communityRoom = `community:${room.communityId}`;
        if (!socket.rooms.has(communityRoom)) return;
        // Fase 3: so quem pode enviar no canal digita; so quem ve recebe.
        const found = await viewableChannel(parsed.data.channelId, user.userId);
        if (!found || (parsed.data.typing && !found.access.send)) return;
        await emitToChannel(io, room.communityId, parsed.data.channelId, 'channel:typing', {
          communityId: room.communityId, channelId: parsed.data.channelId, userId: user.userId, name: user.name, typing: parsed.data.typing,
        }, socket.id);
      } catch {
        // Sinal efemero: falha de banco so descarta o aviso.
      }
    });

    socket.on('join-room', async (data, callback) => {
      // Rate limit check
      if (isRateLimited(`socket:${socket.id}`)) {
        callback?.({ error: 'Rate limit exceeded. Max 30 messages/second.' });
        return;
      }

      const parsed = joinRoomSchema.safeParse(data);
      if (!parsed.success) {
        callback?.({ error: 'Invalid payload', details: parsed.error.flatten() });
        return;
      }

      const { roomId, inviteToken, password } = parsed.data;

      try {
        const room = await prisma.room.findUnique({
          where: { id: roomId },
        });

        if (!room) {
          callback?.({ error: 'Room not found' });
          return;
        }

        if (room.status !== 'ACTIVE') {
          callback?.({ error: 'Room is no longer active' });
          return;
        }

        if (room.expiresAt && new Date(room.expiresAt) < new Date()) {
          callback?.({ error: 'Room has expired' });
          return;
        }

        // Balde de falhas de credencial por IP+sala (10 / 15 min): checado
        // ANTES do bcrypt, so falhas contam.
        const clientIp = getSocketClientIp(socket.request, getEnv().TRUST_PROXY);
        if (room.communityId) {
          if (!user.userId || !(await prisma.communityMember.findUnique({ where: { communityId_userId: { communityId: room.communityId, userId: user.userId } } }))) {
            callback?.({ error: 'Room not found' }); return;
          }
          if (room.channelKind !== 'VOICE') { callback?.({ error: 'Not a voice channel' }); return; }
          // Fase 3: canal de voz invisivel para o membro = inexistente.
          if (!(await viewableChannel(room.id, user.userId))) { callback?.({ error: 'Room not found' }); return; }
        }
        const isProtected = !room.communityId && (room.passwordHash !== null || room.isPrivate);
        if (isProtected) {
          const locked = isRoomAuthLocked(clientIp, roomId);
          if (locked.limited) {
            callback?.({
              error: 'Too many failed room credential attempts. Try again later.',
              retryAfterSeconds: locked.retryAfterSeconds,
            });
            return;
          }
        }

        // Access control: protected rooms accept a valid invite token OR the correct password
        if (!room.communityId && room.passwordHash) {
          const hasValidInvite =
            inviteToken !== undefined && inviteToken === room.inviteToken;
          const hasValidPassword =
            password !== undefined &&
            (await bcrypt.compare(password, room.passwordHash));
          if (!hasValidInvite && !hasValidPassword) {
            recordRoomAuthFailure(clientIp, roomId);
            callback?.({ error: 'Invalid invite token or password' });
            return;
          }
        } else if (!room.communityId && room.isPrivate && inviteToken !== room.inviteToken) {
          // Check invite token for private rooms
          recordRoomAuthFailure(clientIp, roomId);
          callback?.({ error: 'Invalid invite token' });
          return;
        }

        // Check participant limit
        const peers = roomPeers.get(roomId) ?? new Map();
        if (peers.size >= Math.min(room.maxParticipants, MAX_PARTICIPANTS)) {
          callback?.({ error: 'Room is full' });
          return;
        }

        // Um socket esta em UMA sala por vez: entrar em B sai de A antes (peers
        // de A recebem room:peer-left e o socket deixa o canal de A). Sem isto
        // o socket ficava em roomPeers de A recebendo e sinalizando para ela.
        const previousRoomId = socket.data.roomId as string | undefined;
        if (previousRoomId && previousRoomId !== roomId) {
          handleLeaveRoom(io, socket, previousRoomId);
          socket.data.roomId = undefined;
        }

        // Cancela timer de auto-delete se alguém voltou (sala reocupada)
        const existingTimer = emptyTimers.get(roomId);
        if (existingTimer) {
          clearTimeout(existingTimer);
          emptyTimers.delete(roomId);
        }

        // Gate de partilha de tela: lido UMA vez por join (socket.data), nao a
        // cada sinal. Convidado nunca compartilha. Mudanca de idade/termo
        // reemite via REST (broadcastScreenShareGate em routes/profile.ts).
        let gate: ScreenShareGate = GUEST_SCREEN_SHARE_GATE;
        if (user.userId) {
          const row = await prisma.user.findUnique({ where: { id: user.userId }, select: screenShareGateSelect });
          gate = computeScreenShareGate(row, { minAge: await getEffectiveMinAge() });
        }
        socket.data.screenShare = gate;

        // Add peer to room
        peers.set(socket.id, {
          socketId: socket.id,
          userId: user.userId,
          name: user.name,
          guestName: user.guestName,
          guestId: user.guestId,
          muted: parsed.data.muted ?? false,
          deafened: false,
          screenSharing: false,
        });
        roomPeers.set(roomId, peers);
        if (room.communityId) { roomCommunities.set(roomId, room.communityId); emitVoiceState(io, roomId); }

        // Join socket room
        socket.join(roomId);
        socket.data.roomId = roomId;

        // Notify others
        const joined: PeerInfo = {
          peerId: socket.id,
          isRegistered: user.userId !== null,
          name: user.name,
          guestName: user.guestName,
          muted: parsed.data.muted ?? false,
        };
        // ICE servers (STUN + TURN com credencial temporaria) para QUEM ENTROU,
        // logado ou convidado — senha/convite ja foram validados acima. Emitido
        // ANTES do room:peer-joined: a offer de um peer antigo so nasce depois
        // dele, e o Socket.io entrega em ordem, entao o PC do novato ja nasce
        // com o relay configurado (sem TURN, CGNAT/4G = ninguem se ouve).
        socket.emit('room:ice-servers', { roomId, ...buildIceServers(socket.id) });

        socket.to(roomId).emit('room:peer-joined', joined);

        // Send current peers list to the new joiner.
        //
        // O wire usa `peerId` (mesmo shape de `room:peer-joined` e dos eventos
        // `signal:*` que trafegam `targetPeerId`/`fromPeerId`). O mapa interno
        // guarda `socketId`, então a conversão para o nome público acontece
        // aqui. Sem isso o cliente recebia `socketId` e lia `peer.peerId` como
        // `undefined` em `connectToPeers`, travando a malha sempre que o peer
        // mais antigo não era o que iniciava a offer.
        const peersList = Array.from(peers.values())
          .filter((p) => p.socketId !== socket.id)
          .map((p): PeerInfo => ({
            peerId: p.socketId,
            isRegistered: p.userId !== null,
            name: p.name,
            guestName: p.guestName,
            muted: p.muted,
          }));

        // Histórico de chat: 200 recentes se persistente (ASC), buffer FIFO se temporária
        let history: PublicChatMessage[] = [];
        if (room.isPersistent) {
          const recent = await prisma.chatMessage.findMany({
            where: { roomId },
            orderBy: { createdAt: 'desc' },
            take: 200,
            include: { files: true },
          });
          history = recent.reverse().map((m) => toPublicMessage(m, viewerOf(user))); // ASC conforme spec
        } else {
          history = (chatBuffers.get(roomId) ?? [])
            .slice(-100)
            .map((m) => toPublicMessage(m, viewerOf(user)));
        }

        // Room ticket: prova de participacao para historico/arquivos/upload
        // (lib/roomTicket.ts). Vai no ack E num evento proprio — o useSocket
        // repassa so peers/history do ack, o useChat escuta `room:ticket`.
        const subject = ticketSubject({ userId: user.userId, guestId: user.guestId ?? null });
        const ticket = subject ? signRoomTicket(roomId, subject) : undefined;
        if (ticket) socket.emit('room:ticket', { roomId, ticket });

        callback?.({
          success: true,
          peers: peersList,
          roomId,
          history,
          ticket,
        });

        // emitir chat:system para a sala
        socket.to(roomId).emit('chat:system', {
          roomId,
          text: `${user.name} entrou`,
          kind: 'join',
        });
      } catch {
        callback?.({ error: 'Internal server error' });
      }
    });

    socket.on('leave-room', (data, callback) => {
      if (isRateLimited(`socket:${socket.id}`)) {
        callback?.({ error: 'Rate limit exceeded. Max 30 messages/second.' });
        return;
      }

      const parsed = leaveRoomSchema.safeParse(data);
      if (!parsed.success) {
        callback?.({ error: 'Invalid payload', details: parsed.error.flatten() });
        return;
      }

      handleLeaveRoom(io, socket, parsed.data.roomId);
      callback?.({ success: true });
    });

    socket.on('signal:offer', (data, callback) => {
      if (isRateLimited(`socket:${socket.id}`)) {
        callback?.({ error: 'Rate limit exceeded. Max 30 messages/second.' });
        return;
      }

      const parsed = offerSchema.safeParse(data);
      if (!parsed.success) {
        callback?.({ error: 'Invalid payload', details: parsed.error.flatten() });
        return;
      }

      const { roomId, targetPeerId, offer } = parsed.data;
      if (!senderInRoom(roomId)) {
        callback?.({ error: 'Not in room' });
        return;
      }
      const peers = roomPeers.get(roomId);
      if (!peers?.has(targetPeerId)) {
        callback?.({ error: 'Target peer not in room' });
        return;
      }

      io.to(targetPeerId).emit('signal:offer', {
        fromPeerId: socket.id,
        isRegistered: user.userId !== null,
        name: user.name,
        offer,
      });
      callback?.({ success: true });
    });

    socket.on('signal:answer', (data, callback) => {
      if (isRateLimited(`socket:${socket.id}`)) {
        callback?.({ error: 'Rate limit exceeded. Max 30 messages/second.' });
        return;
      }

      const parsed = answerSchema.safeParse(data);
      if (!parsed.success) {
        callback?.({ error: 'Invalid payload', details: parsed.error.flatten() });
        return;
      }

      const { roomId, targetPeerId, answer } = parsed.data;
      if (!senderInRoom(roomId)) {
        callback?.({ error: 'Not in room' });
        return;
      }
      const peers = roomPeers.get(roomId);
      if (!peers?.has(targetPeerId)) {
        callback?.({ error: 'Target peer not in room' });
        return;
      }

      io.to(targetPeerId).emit('signal:answer', {
        fromPeerId: socket.id,
        isRegistered: user.userId !== null,
        name: user.name,
        answer,
      });
      callback?.({ success: true });
    });

    socket.on('signal:ice-candidate', (data, callback) => {
      if (isRateLimited(`socket:${socket.id}`)) {
        callback?.({ error: 'Rate limit exceeded. Max 30 messages/second.' });
        return;
      }

      const parsed = iceCandidateSchema.safeParse(data);
      if (!parsed.success) {
        callback?.({ error: 'Invalid payload', details: parsed.error.flatten() });
        return;
      }

      const { roomId, targetPeerId, candidate } = parsed.data;
      if (!senderInRoom(roomId)) {
        callback?.({ error: 'Not in room' });
        return;
      }
      const peers = roomPeers.get(roomId);
      if (!peers?.has(targetPeerId)) {
        callback?.({ error: 'Target peer not in room' });
        return;
      }

      io.to(targetPeerId).emit('signal:ice-candidate', {
        fromPeerId: socket.id,
        isRegistered: user.userId !== null,
        candidate,
      });
      callback?.({ success: true });
    });

    socket.on('signal:screen-share-state', (data, callback) => {
      if (isRateLimited(`socket:${socket.id}`)) {
        callback?.({ error: 'Rate limit exceeded. Max 30 messages/second.' });
        return;
      }

      const parsed = screenShareStateSchema.safeParse(data);
      if (!parsed.success) {
        callback?.({ error: 'Invalid payload', details: parsed.error.flatten() });
        return;
      }

      const { roomId, targetPeerId, isScreenSharing } = parsed.data;
      if (!senderInRoom(roomId)) {
        callback?.({ error: 'Not in room' });
        return;
      }
      const peers = roomPeers.get(roomId);
      if (!peers?.has(targetPeerId)) {
        callback?.({ error: 'Target peer not in room' });
        return;
      }
      // Enforcement do gate no SERVIDOR: ligar a partilha sem idade/termo e
      // recusado (nao repassa). Desligar sempre passa.
      if (isScreenSharing) {
        const gate: ScreenShareGate = socket.data.screenShare ?? GUEST_SCREEN_SHARE_GATE;
        if (!gate.allowed) {
          callback?.({ error: 'Partilha de tela nao liberada', code: 'SCREEN_SHARE_NOT_ALLOWED', reason: gate.reason });
          return;
        }
      }

      io.to(targetPeerId).emit('signal:screen-share-state', {
        fromPeerId: socket.id,
        isScreenSharing,
      });
      callback?.({ success: true });
    });

    // Microfone ligou/desligou: guarda (para quem entrar depois) e avisa a sala.
    socket.on('peer:audio-state', (data, callback) => {
      if (isRateLimited(`socket:${socket.id}`)) {
        callback?.({ error: 'Rate limit exceeded. Max 30 messages/second.' });
        return;
      }

      const parsed = audioStateSchema.safeParse(data);
      if (!parsed.success) {
        callback?.({ error: 'Invalid payload', details: parsed.error.flatten() });
        return;
      }

      const { roomId, muted } = parsed.data;
      if (!senderInRoom(roomId)) {
        callback?.({ error: 'Not in room' });
        return;
      }
      const peer = roomPeers.get(roomId)?.get(socket.id);
      if (peer && peer.muted !== muted) {
        peer.muted = muted;
        emitVoiceState(io, roomId);
      }

      socket.to(roomId).emit('room:peer-audio-state', { peerId: socket.id, muted });
      callback?.({ success: true });
    });

    // Deafen, tela e "falando" do proprio peer, para os indicadores do canal de
    // voz da comunidade. Deafen/tela mudam o estado guardado (quem assina depois
    // ve); "falando" e transitorio e sai num evento compacto. O cliente so manda
    // transicoes, com intervalo minimo; o balde de 30/s por socket segura abuso.
    socket.on('peer:voice-flags', (data, callback) => {
      if (isRateLimited(`socket:${socket.id}`)) {
        callback?.({ error: 'Rate limit exceeded. Max 30 messages/second.' });
        return;
      }
      const parsed = voiceFlagsSchema.safeParse(data);
      if (!parsed.success) {
        callback?.({ error: 'Invalid payload' });
        return;
      }
      const { roomId, deafened, screenSharing, speaking } = parsed.data;
      const peer = roomPeers.get(roomId)?.get(socket.id);
      if (!senderInRoom(roomId) || !peer) {
        callback?.({ error: 'Not in room' });
        return;
      }
      // Mesmo gate do signal:screen-share-state: sem liberacao, "Ao vivo" nao liga.
      if (screenSharing === true && !(socket.data.screenShare ?? GUEST_SCREEN_SHARE_GATE).allowed) {
        callback?.({ error: 'Partilha de tela nao liberada', code: 'SCREEN_SHARE_NOT_ALLOWED' });
        return;
      }
      let changed = false;
      if (deafened !== undefined && peer.deafened !== deafened) { peer.deafened = deafened; changed = true; }
      if (screenSharing !== undefined && peer.screenSharing !== screenSharing) { peer.screenSharing = screenSharing; changed = true; }
      if (changed) emitVoiceState(io, roomId);
      const communityId = roomCommunities.get(roomId);
      if (speaking !== undefined && communityId && peer.userId) {
        io.to(`community:${communityId}`).emit('community:voice-speaking', {
          channelId: roomId,
          userId: peer.userId,
          speaking: speaking && !peer.muted,
        });
      }
      callback?.({ success: true });
    });

    socket.on('chat:message', async (data, callback) => {
      if (
        isRateLimited(`socket:${socket.id}`) ||
        isChatRateLimited(`chat:${socket.id}`)
      ) {
        callback?.({ error: 'Rate limit exceeded. Max 5 messages/5s.' });
        return;
      }

      // trim antes de validar para respeitar 1..500 após trim
      const trimmed =
        typeof data?.content === 'string'
          ? { ...data, content: data.content.trim() }
          : data;
      const parsed = chatMessageSchema.safeParse(trimmed);
      if (!parsed.success) {
        callback?.({ error: 'Invalid payload', details: parsed.error.flatten() });
        return;
      }

      const { roomId, content, mentions } = parsed.data;

      // membership
      const peers = roomPeers.get(roomId);
      if (!peers?.has(socket.id)) {
        callback?.({ error: 'Not in room', details: { roomId } });
        return;
      }

      // room existe e ACTIVE
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.status !== 'ACTIVE') {
        callback?.({ error: 'Room not found' });
        return;
      }
      if (room.expiresAt && new Date(room.expiresAt) < new Date()) {
        callback?.({ error: 'Room has expired' });
        return;
      }

      // mentions intersect
      const peersNames = new Set(Array.from(peers.values()).map((p) => p.name));
      const rawMentions = mentions ?? [];
      // extrai via regex se cliente não enviou mentions (defesa)
      if (rawMentions.length === 0) {
        const mentionRegex = /@(\w[\w .-]{0,49})/g;
        let m: RegExpExecArray | null;
        while ((m = mentionRegex.exec(content)) !== null) {
          rawMentions.push(m[1]);
        }
      }
      const intersected = rawMentions.filter((n) => peersNames.has(n)).slice(0, 8);

      const user: SocketUser = socket.data.user;

      // Moderacao ANTES de gravar/retransmitir (spec 4.1): high bloqueia,
      // medium entrega e avisa so o autor.
      const verdict = await moderateText(content);
      if (verdict.severity === 'high') {
        void recordModerationEvent({
          kind: 'text', source: 'chat', roomId, userId: user.userId, guestId: user.userId ? null : (user.guestId ?? null),
          category: verdict.category, severity: verdict.severity, action: 'blocked', excerpt: content,
        });
        callback?.({ error: 'Mensagem bloqueada pela moderacao', code: 'MODERATED', category: verdict.category });
        return;
      }

      let savedMsg: ChatMessageRow;
      if (room.isPersistent) {
        const created = await prisma.chatMessage.create({
          data: {
            roomId,
            content,
            authorId: user.userId,
            guestName: user.guestName ?? user.name,
            guestId: user.userId ? null : (user.guestId ?? null),
          },
        });
        savedMsg = created as ChatMessageRow;
      } else {
        const id = crypto.randomUUID();
        savedMsg = {
          id,
          roomId,
          content,
          authorId: user.userId,
          // Nome exibido: o authorId nunca sai do servidor, entao usuario
          // logado tambem precisa do nome aqui (igual a sala persistente).
          guestName: user.guestName ?? user.name,
          guestId: user.userId ? null : (user.guestId ?? null),
          createdAt: new Date(),
        };
        const buf = chatBuffers.get(roomId) ?? [];
        buf.push(savedMsg);
        if (buf.length > CHAT_BUFFER_LIMIT) buf.shift(); // FIFO
        chatBuffers.set(roomId, buf);
      }
      incChatMessages(room.isPersistent ? 'persistent' : 'temporary');

      emitChatMessage(io, roomId, savedMsg);
      if (verdict.severity === 'medium') {
        void recordModerationEvent({
          kind: 'text', source: 'chat', roomId, userId: user.userId, guestId: user.userId ? null : (user.guestId ?? null),
          category: verdict.category, severity: verdict.severity, action: 'warned', excerpt: content,
        });
        socket.emit('moderation:warning', chatWarning(roomId, verdict.category));
      }
      // fan-out mention
      for (const name of intersected) {
        for (const [sid, peer] of peers.entries()) {
          if (peer.name === name) {
            io.to(sid).emit('chat:mention', { messageId: savedMsg.id, roomId });
          }
        }
      }
      callback?.({ success: true, messageId: savedMsg.id });
    });

    socket.on('chat:edit', async (data, callback) => {
      if (
        isRateLimited(`socket:${socket.id}`) ||
        isChatRateLimited(`chat:${socket.id}`)
      ) {
        callback?.({ error: 'Rate limit exceeded. Max 5 messages/5s.' });
        return;
      }

      // trim antes de validar para respeitar 1..500 após trim
      const trimmed =
        typeof data?.content === 'string'
          ? { ...data, content: data.content.trim() }
          : data;
      const parsed = chatEditSchema.safeParse(trimmed);
      if (!parsed.success) {
        callback?.({ error: 'Invalid payload', details: parsed.error.flatten() });
        return;
      }

      const { roomId, messageId, content } = parsed.data;

      // membership
      if (!roomPeers.get(roomId)?.has(socket.id)) {
        callback?.({ error: 'Not in room' });
        return;
      }

      const msg = await prisma.chatMessage.findUnique({
        where: { id: messageId },
      });
      if (!msg || msg.roomId !== roomId) {
        callback?.({ error: 'Message not found' });
        return;
      }
      if (msg.deletedAt) {
        callback?.({ error: 'Cannot edit deleted message' });
        return;
      }

      const user: SocketUser = socket.data.user;
      const isAuthor = isMessageAuthor(msg, viewerOf(user));
      if (!isAuthor) {
        callback?.({ error: 'Not message author' });
        return;
      }

      // Janela de edição: 15 minutos desde a criação
      if (Date.now() - new Date(msg.createdAt).getTime() > CHAT_EDIT_WINDOW_MS) {
        callback?.({ error: 'Edit window expired' });
        return;
      }

      const verdict = await moderateText(content);
      if (verdict.severity === 'high') {
        void recordModerationEvent({
          kind: 'text', source: 'chat', roomId, userId: user.userId, guestId: user.userId ? null : (user.guestId ?? null),
          category: verdict.category, severity: verdict.severity, action: 'blocked', excerpt: content,
        });
        callback?.({ error: 'Mensagem bloqueada pela moderacao', code: 'MODERATED', category: verdict.category });
        return;
      }

      const updated = await prisma.chatMessage.update({
        where: { id: messageId },
        data: { prevContent: msg.content, content, editedAt: new Date() },
      });
      incChatEdits();

      io.to(roomId).emit('chat:edit', {
        messageId,
        content: updated.content,
        editedAt: updated.editedAt,
        // `prevContent` nunca trafega: a UI so precisa saber que foi editada.
        edited: true,
      });
      if (verdict.severity === 'medium') {
        void recordModerationEvent({
          kind: 'text', source: 'chat', roomId, userId: user.userId, guestId: user.userId ? null : (user.guestId ?? null),
          category: verdict.category, severity: verdict.severity, action: 'warned', excerpt: content,
        });
        socket.emit('moderation:warning', chatWarning(roomId, verdict.category));
      }
      callback?.({ success: true });
    });

    // Denuncia de um participante (spec 4.3): grava o evento e avisa o dono
    // da sala se ele estiver nela agora. Quem denuncia nunca sabe o resultado.
    socket.on('moderation:report', async (data, callback) => {
      if (isRateLimited(`socket:${socket.id}`)) {
        callback?.({ error: 'Rate limit exceeded. Max 30 messages/second.' });
        return;
      }
      const parsed = moderationReportSchema.safeParse(data);
      if (!parsed.success) {
        callback?.({ error: 'Invalid payload', details: parsed.error.flatten() });
        return;
      }
      const { roomId, targetPeerId, reason, details } = parsed.data;
      if (!senderInRoom(roomId)) {
        callback?.({ error: 'Not in room' });
        return;
      }
      const peers = roomPeers.get(roomId);
      const target = peers?.get(targetPeerId);
      if (!target) {
        callback?.({ error: 'Target peer not in room' });
        return;
      }
      if (targetPeerId === socket.id) {
        callback?.({ error: 'Cannot report yourself' });
        return;
      }
      const limit = isModerationReportRateLimited(socket.id);
      if (limit.limited) {
        callback?.({ error: 'Too many reports. Try again later.', retryAfterSeconds: limit.retryAfterSeconds });
        return;
      }

      const reporter: SocketUser = socket.data.user;
      const category = reason === 'other' ? 'none' : reason;
      await recordModerationEvent({
        kind: 'report', source: 'user', roomId,
        userId: target.userId, guestId: target.userId ? null : (target.guestId ?? null),
        reporterId: reporter.userId,
        category, severity: 'medium', action: 'reported', excerpt: details ?? null,
      });

      const room = await prisma.room.findUnique({ where: { id: roomId }, select: { ownerId: true } });
      const notice: ModerationNoticePayload = { roomId, peerId: targetPeerId, kind: 'report', category };
      for (const sid of getRoomOwnerSocketIds(roomId, room?.ownerId ?? null)) {
        if (sid !== socket.id) io.to(sid).emit('moderation:notice', notice);
      }
      callback?.({ success: true });
    });

    // Dono da sala interrompe a partilha de tela de um participante.
    socket.on('moderation:stop-share', async (data, callback) => {
      if (isRateLimited(`socket:${socket.id}`)) {
        callback?.({ error: 'Rate limit exceeded. Max 30 messages/second.' });
        return;
      }
      const parsed = moderationStopShareSchema.safeParse(data);
      if (!parsed.success) {
        callback?.({ error: 'Invalid payload', details: parsed.error.flatten() });
        return;
      }
      const { roomId, targetPeerId } = parsed.data;
      if (!senderInRoom(roomId)) {
        callback?.({ error: 'Not in room' });
        return;
      }
      const target = roomPeers.get(roomId)?.get(targetPeerId);
      if (!target) {
        callback?.({ error: 'Target peer not in room' });
        return;
      }
      const me: SocketUser = socket.data.user;
      const room = await prisma.room.findUnique({ where: { id: roomId }, select: { ownerId: true } });
      if (!me.userId || !room?.ownerId || room.ownerId !== me.userId) {
        callback?.({ error: 'Not room owner', code: 'NOT_OWNER' });
        return;
      }
      void recordModerationEvent({
        kind: 'report', source: 'user', roomId,
        userId: target.userId, guestId: target.userId ? null : (target.guestId ?? null),
        reporterId: me.userId, category: 'none', severity: 'high', action: 'stopped-share',
      });
      const action: ModerationActionPayload = { roomId, action: 'stop-screen-share', category: 'none', by: 'owner' };
      io.to(targetPeerId).emit('moderation:action', action);
      callback?.({ success: true });
    });

    socket.on('chat:delete', async (data, callback) => {
      if (
        isRateLimited(`socket:${socket.id}`) ||
        isChatRateLimited(`chat:${socket.id}`)
      ) {
        callback?.({ error: 'Rate limit exceeded. Max 5 messages/5s.' });
        return;
      }

      const parsed = chatDeleteSchema.safeParse(data);
      if (!parsed.success) {
        callback?.({ error: 'Invalid payload', details: parsed.error.flatten() });
        return;
      }

      const { roomId, messageId } = parsed.data;

      // membership
      if (!roomPeers.get(roomId)?.has(socket.id)) {
        callback?.({ error: 'Not in room' });
        return;
      }

      const [msg, room] = await Promise.all([
        prisma.chatMessage.findUnique({ where: { id: messageId } }),
        prisma.room.findUnique({ where: { id: roomId } }),
      ]);
      if (!msg || msg.roomId !== roomId) {
        callback?.({ error: 'Message not found' });
        return;
      }
      // idempotente
      if (msg.deletedAt) {
        callback?.({ success: true });
        return;
      }

      const user: SocketUser = socket.data.user;
      const isAuthor = isMessageAuthor(msg, viewerOf(user));
      const isOwner = room?.ownerId && room.ownerId === user.userId;
      if (!isAuthor && !isOwner) {
        callback?.({ error: 'Not authorized to delete' });
        return;
      }

      const now = new Date();
      await prisma.chatMessage.update({
        where: { id: messageId },
        // prevContent tambem e limpo: apagar nao pode deixar a versao anterior
        // da mensagem recuperavel.
        data: { deletedAt: now, content: DELETED_MESSAGE_CONTENT, prevContent: null },
      });
      // cascade soft em arquivos da mensagem
      await prisma.chatFile.updateMany({
        where: { messageId },
        data: { deletedAt: now },
      });
      incChatDeletes();

      io.to(roomId).emit('chat:delete', { messageId, deletedAt: now });
      callback?.({ success: true });
    });

    socket.on('disconnect', () => {
      const roomId = socket.data.roomId as string | undefined;
      if (roomId) {
        handleLeaveRoom(io, socket, roomId);
      }
    });
  });

  return io;
}

/**
 * Expulsa TODOS da sala (sala apagada): avisa com `room:deleted`, tira os
 * sockets do canal e limpa o estado em memoria (peers, buffer do chat e timer
 * de auto-delete). Chamado pela rota DELETE /api/rooms/:id.
 */
export function evictRoom(io: Server | undefined, roomId: string): void {
  if (io) {
    const payload: RoomDeletedEvent = { roomId };
    io.to(roomId).emit('room:deleted', payload);
    const peers = roomPeers.get(roomId);
    if (peers) {
      for (const socketId of peers.keys()) {
        const sock = io.sockets.sockets.get(socketId);
        if (sock && sock.data.roomId === roomId) sock.data.roomId = undefined;
      }
    }
    io.in(roomId).socketsLeave(roomId);
  }
  roomPeers.delete(roomId);
  roomCommunities.delete(roomId);
  chatBuffers.delete(roomId);
  const timer = emptyTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    emptyTimers.delete(roomId);
  }
}

function handleLeaveRoom(
  io: Server,
  socket: Socket,
  roomId: string,
): void {
  const peers = roomPeers.get(roomId);
  if (!peers) return;

  peers.delete(socket.id);
  emitVoiceState(io, roomId);

  if (peers.size === 0) {
    roomPeers.delete(roomId);
    roomCommunities.delete(roomId);
    // Agenda auto-delete após 5 min vazia (só salas temporárias)
    if (!emptyTimers.has(roomId)) {
      const timer = setTimeout(async () => {
        emptyTimers.delete(roomId);
        try {
          const room = await prisma.room.findUnique({ where: { id: roomId } });
          if (room && !room.isPersistent) {
            await prisma.room.delete({ where: { id: roomId } });
            chatBuffers.delete(roomId);
            console.log(`[rooms] Auto-deleted empty temp room ${roomId} after 5min`);
          }
        } catch (e) {
          console.error(`[rooms] Failed to auto-delete ${roomId}`, e);
        }
      }, EMPTY_ROOM_TTL_MS);
      emptyTimers.set(roomId, timer);
    }
  } else {
    socket.to(roomId).emit('room:peer-left', {
      peerId: socket.id,
    });
    // chat:system leave para os demais peers
    const userName =
      (socket.data.user as SocketUser | undefined)?.name ?? 'Alguém';
    socket.to(roomId).emit('chat:system', {
      roomId,
      text: `${userName} saiu`,
      kind: 'leave',
    });
  }

  socket.leave(roomId);
}

/** Aviso ao autor de mensagem marcada como `medium`. */
function chatWarning(roomId: string, category: ModerationWarningPayload['category']): ModerationWarningPayload {
  return {
    roomId,
    category,
    text: 'Sua mensagem foi marcada pelo assistente de moderacao. Mantenha o respeito com os participantes.',
  };
}

function voiceState(channelId: string) {
  const members = Array.from(roomPeers.get(channelId)?.values() ?? [])
    .filter((peer): peer is RoomPeer & { userId: string } => peer.userId !== null)
    .map(({ userId, name, muted, deafened, screenSharing }) => ({ userId, name, muted, deafened, screenSharing }));
  return { channelId, members };
}

function emitVoiceState(io: Server, channelId: string): void {
  const communityId = roomCommunities.get(channelId);
  if (!communityId) return;
  io.to(`community:${communityId}`).emit('community:voice-state', voiceState(channelId));
}

export function evictChannel(io: Server | undefined, channelId: string): void {
  evictRoom(io, channelId);
}

export async function evictCommunityUser(io: Server | undefined, communityId: string, userId: string): Promise<void> {
  if (!io) return;
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  const channels = await prisma.room.findMany({ where: { communityId }, select: { id: true } });
  const ids = new Set(channels.map((channel) => channel.id));
  for (const remote of sockets) {
    const socket = io.sockets.sockets.get(remote.id);
    if (!socket) continue;
    await socket.leave(`community:${communityId}`);
    const roomId = socket.data.roomId as string | undefined;
    if (roomId && ids.has(roomId)) { handleLeaveRoom(io, socket, roomId); socket.data.roomId = undefined; }
  }
  io.to(userRoom(userId)).emit('community:removed', { communityId });
}

export async function evictCommunity(io: Server | undefined, communityId: string): Promise<void> {
  if (!io) return;
  const channels = await prisma.room.findMany({ where: { communityId }, select: { id: true } });
  for (const channel of channels) evictChannel(io, channel.id);
  io.in(`community:${communityId}`).socketsLeave(`community:${communityId}`);
}

/** Leitor (para isMine) a partir do usuario do socket. */
function viewerOf(user: { userId: string | null; guestId?: string }): MessageViewer {
  return { userId: user.userId, guestId: user.guestId ?? null };
}

/**
 * Broadcast de `chat:message` com DTO publico POR DESTINATARIO: cada peer
 * recebe `isMine` calculado para si (o authorId nunca sai do servidor).
 * Usado pelo chat:message do socket e pelo upload (routes/files.ts).
 */
export function emitChatMessage(io: Server, roomId: string, msg: ChatMessageSource): void {
  const peers = roomPeers.get(roomId);
  if (!peers) return;
  for (const [sid, peer] of peers) {
    io.to(sid).emit(
      'chat:message',
      toPublicMessage(msg, viewerOf(peer)),
    );
  }
}
