import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../lib/auth.js';
import { isRateLimited } from '../lib/rateLimit.js';
import {
  joinRoomSchema,
  leaveRoomSchema,
  offerSchema,
  answerSchema,
  iceCandidateSchema,
  screenShareStateSchema,
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

      const { roomId, inviteToken } = parsed.data;

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

        // Check invite token for private rooms
        if (room.isPrivate && inviteToken !== room.inviteToken) {
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

        callback?.({
          success: true,
          peers: peersList,
          roomId,
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
  }

  socket.leave(roomId);
}
