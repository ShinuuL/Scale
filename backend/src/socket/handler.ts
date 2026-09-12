import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../lib/auth.js';
import { isTailnetAllowed, normalizeIp } from '../plugins/checkTailscale.js';
import { isRateLimited, isChatRateLimited } from '../lib/rateLimit.js';
import { incChatMessages, incChatEdits, incChatDeletes } from '../lib/metrics.js';
import {
  joinRoomSchema,
  leaveRoomSchema,
  offerSchema,
  answerSchema,
  iceCandidateSchema,
  screenShareStateSchema,
  chatMessageSchema,
  chatEditSchema,
  chatDeleteSchema,
} from './validation.js';

interface SocketUser {
  userId: string | null;
  email: string | null;
  name: string;
  guestName?: string;
}

interface RoomPeer {
  socketId: string;
  userId: string | null;
  name: string;
  guestName?: string;
}

const roomPeers = new Map<string, Map<string, RoomPeer>>();
const emptyTimers = new Map<string, NodeJS.Timeout>();

const MAX_PARTICIPANTS = 8;
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000; // 5 minutos vazia → apaga (temporárias)

// --- Chat (Opção A) — buffer FIFO ~100 por sala temporária ---

export interface ChatMessageRow {
  id: string;
  roomId: string;
  content: string;
  authorId: string | null;
  guestName?: string;
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

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) ?? [
        'http://localhost:3000',
      ],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Tailnet barrier (critic item 6): Socket.io exige a mesma regra do
  // checkTailscaleOrigin do REST (isTailnetAllowed) — permitido quando:
  //   1. IP privado/loopback/CGNAT (LAN, bridge do Docker, tailnet);
  //   2. `Host` interno do compose/rewrite (backend:4000, localhost:3000…);
  //   3. `Host` contém `TAILSCALE_HOST` (MagicDNS);
  //   4. `Origin` está na allowlist `ALLOWED_ORIGINS`;
  //   5. NODE_ENV=test.
  // Fora isso → connect_error "Tailnet only" (o REST responde 403 equivalente).
  io.use((socket, next) => {
    const rawIp =
      socket.handshake.headers['x-forwarded-for'] ??
      socket.handshake.address ??
      '';
    const ip = normalizeIp(String(rawIp).split(',')[0]);
    const host = socket.handshake.headers.host ?? '';
    const origin = socket.handshake.headers.origin ?? '';

    if (isTailnetAllowed({ ip, host, origin })) return next();
    return next(new Error('Tailnet only'));
  });

  // Optional auth middleware
  io.use(async (socket, next) => {
    const token =
      socket.handshake.auth?.token ??
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

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
          name: socket.handshake.auth?.guestName ?? 'Guest',
          guestName: socket.handshake.auth?.guestName ?? 'Guest',
        } satisfies SocketUser;
      }
    } else {
      socket.data.user = {
        userId: null,
        email: null,
        name: socket.handshake.auth?.guestName ?? 'Guest',
        guestName: socket.handshake.auth?.guestName ?? 'Guest',
      } satisfies SocketUser;
    }
    next();
  });

  io.on('connection', (socket) => {
    const user: SocketUser = socket.data.user;

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

        // Access control: protected rooms accept a valid invite token OR the correct password
        if (room.passwordHash) {
          const hasValidInvite =
            inviteToken !== undefined && inviteToken === room.inviteToken;
          const hasValidPassword =
            password !== undefined &&
            (await bcrypt.compare(password, room.passwordHash));
          if (!hasValidInvite && !hasValidPassword) {
            callback?.({ error: 'Invalid invite token or password' });
            return;
          }
        } else if (room.isPrivate && inviteToken !== room.inviteToken) {
          // Check invite token for private rooms
          callback?.({ error: 'Invalid invite token' });
          return;
        }

        // Check participant limit
        const peers = roomPeers.get(roomId) ?? new Map();
        if (peers.size >= Math.min(room.maxParticipants, MAX_PARTICIPANTS)) {
          callback?.({ error: 'Room is full' });
          return;
        }

        // Cancela timer de auto-delete se alguém voltou (sala reocupada)
        const existingTimer = emptyTimers.get(roomId);
        if (existingTimer) {
          clearTimeout(existingTimer);
          emptyTimers.delete(roomId);
        }

        // Add peer to room
        peers.set(socket.id, {
          socketId: socket.id,
          userId: user.userId,
          name: user.name,
          guestName: user.guestName,
        });
        roomPeers.set(roomId, peers);

        // Join socket room
        socket.join(roomId);
        socket.data.roomId = roomId;

        // Notify others
        socket.to(roomId).emit('room:peer-joined', {
          peerId: socket.id,
          userId: user.userId,
          name: user.name,
          guestName: user.guestName,
        });

        // Send current peers list to the new joiner
        const peersList = Array.from(peers.values()).filter(
          (p) => p.socketId !== socket.id,
        );

        // Histórico de chat: 200 recentes se persistente (ASC), buffer FIFO se temporária
        let history: Array<{
          id: string;
          content: string;
          createdAt: Date;
          deletedAt?: Date | null;
          editedAt?: Date | null;
        }> = [];
        if (room.isPersistent) {
          const recent = await prisma.chatMessage.findMany({
            where: { roomId },
            orderBy: { createdAt: 'desc' },
            take: 200,
            include: { files: true },
          });
          history = recent.reverse(); // entrega ASC conforme spec
        } else {
          history = (chatBuffers.get(roomId) ?? []).slice(-100);
        }

        callback?.({
          success: true,
          peers: peersList,
          roomId,
          history,
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
      const peers = roomPeers.get(roomId);
      if (!peers?.has(targetPeerId)) {
        callback?.({ error: 'Target peer not in room' });
        return;
      }

      io.to(targetPeerId).emit('signal:offer', {
        fromPeerId: socket.id,
        userId: user.userId,
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
      const peers = roomPeers.get(roomId);
      if (!peers?.has(targetPeerId)) {
        callback?.({ error: 'Target peer not in room' });
        return;
      }

      io.to(targetPeerId).emit('signal:answer', {
        fromPeerId: socket.id,
        userId: user.userId,
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
      const peers = roomPeers.get(roomId);
      if (!peers?.has(targetPeerId)) {
        callback?.({ error: 'Target peer not in room' });
        return;
      }

      io.to(targetPeerId).emit('signal:ice-candidate', {
        fromPeerId: socket.id,
        userId: user.userId,
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
      const peers = roomPeers.get(roomId);
      if (!peers?.has(targetPeerId)) {
        callback?.({ error: 'Target peer not in room' });
        return;
      }

      io.to(targetPeerId).emit('signal:screen-share-state', {
        fromPeerId: socket.id,
        isScreenSharing,
      });
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
      let savedMsg: ChatMessageRow;
      if (room.isPersistent) {
        const created = await prisma.chatMessage.create({
          data: {
            roomId,
            content,
            authorId: user.userId,
            guestName: user.guestName ?? user.name,
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
          guestName: user.guestName,
          createdAt: new Date(),
        };
        const buf = chatBuffers.get(roomId) ?? [];
        buf.push(savedMsg);
        if (buf.length > CHAT_BUFFER_LIMIT) buf.shift(); // FIFO
        chatBuffers.set(roomId, buf);
      }
      incChatMessages(room.isPersistent ? 'persistent' : 'temporary');

      io.to(roomId).emit('chat:message', savedMsg);
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
      const isAuthor =
        (msg.authorId && msg.authorId === user.userId) ||
        (!msg.authorId && msg.guestName === (user.guestName ?? user.name));
      if (!isAuthor) {
        callback?.({ error: 'Not message author' });
        return;
      }

      // Janela de edição: 15 minutos desde a criação
      if (Date.now() - new Date(msg.createdAt).getTime() > 15 * 60 * 1000) {
        callback?.({ error: 'Edit window expired' });
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
        prevContent: updated.prevContent,
        editedAt: updated.editedAt,
      });
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
      const isAuthor =
        (msg.authorId && msg.authorId === user.userId) ||
        (!msg.authorId && msg.guestName === (user.guestName ?? user.name));
      const isOwner = room?.ownerId && room.ownerId === user.userId;
      if (!isAuthor && !isOwner) {
        callback?.({ error: 'Not authorized to delete' });
        return;
      }

      const now = new Date();
      await prisma.chatMessage.update({
        where: { id: messageId },
        data: { deletedAt: now, content: '[mensagem apagada]' },
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

function handleLeaveRoom(
  io: Server,
  socket: Socket,
  roomId: string,
): void {
  const peers = roomPeers.get(roomId);
  if (!peers) return;

  peers.delete(socket.id);

  if (peers.size === 0) {
    roomPeers.delete(roomId);
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
