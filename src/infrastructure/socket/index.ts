import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import logger from '../../utils/logger';

/**
 * Realtime store updates over Socket.IO.
 *
 * Clients subscribe with their map viewport; the gateway joins them to the
 * grid "cells" that cover it. Store mutations are emitted only to the cell the
 * store falls in, so a phone only receives updates relevant to what it's
 * looking at — no global broadcast storm.
 *
 * This module also includes a lightweight foundation for future message and
 * notification events. New features can be added as separate event
 * handlers without changing the viewport subscription model.
 */

// ~0.1° ≈ 11 km grid cells. Rooms are keyed by cell index.
const CELL_SIZE = 0.1;

// Guard: a zoomed-out (e.g. country-wide) viewport shouldn't join thousands of
// rooms. Beyond this many cells we stop — those clients get updates on refetch.
const MAX_CELLS = 400;

export interface StoreEventPayload {
  id: string;
  storeName: string;
  isActive: boolean;
  coordinates: { lat: number; lng: number };
}

export interface NotificationEventPayload {
  id: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  sentAt: string;
}

export interface ChatMessagePayload {
  roomId: string;
  senderId: string;
  senderName: string;
  body: string;
  sentAt: string;
  metadata?: Record<string, unknown>;
}

interface Viewport {
  north: number;
  south: number;
  east: number;
  west: number;
}

let io: Server | null = null;

function cellKey(lat: number, lng: number): string {
  const latIdx = Math.floor(lat / CELL_SIZE);
  const lngIdx = Math.floor(lng / CELL_SIZE);
  return `cell:${latIdx}:${lngIdx}`;
}

function notificationChannel(userId: string): string {
  return `notifications:user:${userId}`;
}

function chatRoomKey(roomId: string): string {
  return `chat:room:${roomId}`;
}

function cellsForViewport(vp: Viewport): string[] {
  const cells: string[] = [];
  const latStart = Math.floor(vp.south / CELL_SIZE);
  const latEnd = Math.floor(vp.north / CELL_SIZE);
  const lngStart = Math.floor(vp.west / CELL_SIZE);
  const lngEnd = Math.floor(vp.east / CELL_SIZE);

  for (let la = latStart; la <= latEnd; la++) {
    for (let ln = lngStart; ln <= lngEnd; ln++) {
      cells.push(`cell:${la}:${ln}`);
      if (cells.length >= MAX_CELLS) return cells;
    }
  }
  return cells;
}

function isViewport(v: unknown): v is Viewport {
  if (typeof v !== 'object' || v === null) return false;
  const vp = v as Record<string, unknown>;
  return (
    typeof vp.north === 'number' &&
    typeof vp.south === 'number' &&
    typeof vp.east === 'number' &&
    typeof vp.west === 'number'
  );
}

export function initSocket(server: HttpServer): Server {
  io = new Server(server, {
    // Mobile clients have no fixed web origin; allow all in this phase.
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket: Socket) => {
    logger.info(`[Socket] Client connected: ${socket.id}`);
    let joinedViewportCells: string[] = [];
    let joinedNotificationChannels: string[] = [];
    let joinedChatRooms: string[] = [];

    socket.on('subscribe', (vp: unknown) => {
      if (!isViewport(vp)) return;

      for (const c of joinedViewportCells) void socket.leave(c);
      joinedViewportCells = cellsForViewport(vp);
      for (const c of joinedViewportCells) void socket.join(c);

      logger.info(`[Socket] ${socket.id} subscribed to ${joinedViewportCells.length} cells`);
    });

    socket.on('subscribe_notifications', (payload: unknown) => {
      if (typeof payload !== 'object' || payload === null) return;
      const channel = (payload as { userId?: string }).userId;
      if (!channel || typeof channel !== 'string') return;

      for (const c of joinedNotificationChannels) void socket.leave(c);
      joinedNotificationChannels = [notificationChannel(channel)];
      for (const c of joinedNotificationChannels) void socket.join(c);

      logger.info(`[Socket] ${socket.id} subscribed to notifications for ${channel}`);
    });

    socket.on('join_chat_room', (roomId: unknown) => {
      if (typeof roomId !== 'string' || roomId.trim() === '') return;
      const key = chatRoomKey(roomId);
      if (!joinedChatRooms.includes(key)) {
        joinedChatRooms.push(key);
        void socket.join(key);
      }
      logger.info(`[Socket] ${socket.id} joined chat room ${roomId}`);
    });

    socket.on('leave_chat_room', (roomId: unknown) => {
      if (typeof roomId !== 'string' || roomId.trim() === '') return;
      const key = chatRoomKey(roomId);
      joinedChatRooms = joinedChatRooms.filter((room) => room !== key);
      void socket.leave(key);
      logger.info(`[Socket] ${socket.id} left chat room ${roomId}`);
    });

    socket.on('send_chat_message', (message: unknown) => {
      const payload = message as ChatMessagePayload;
      if (!payload || !payload.roomId || !payload.senderId || !payload.body) return;
      const room = chatRoomKey(payload.roomId);
      io?.to(room).emit('chat:message', payload);
      logger.info(`[Socket] chat:message → ${room} (${payload.senderId})`);
    });

    socket.on('send_notification', (notification: unknown) => {
      const payload = notification as NotificationEventPayload & { userId?: string };
      if (!payload || !payload.userId) return;
      const room = notificationChannel(payload.userId);
      io?.to(room).emit('notification:new', payload);
      logger.info(`[Socket] notification:new → ${room} (${payload.id})`);
    });

    socket.on('disconnect', () => {
      logger.info(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  logger.info('[Socket] Socket.IO gateway initialized');
  return io;
}

/** Broadcast a created/updated store to the cell it sits in. */
export function emitStoreUpserted(store: StoreEventPayload): void {
  if (!io) return;
  const room = cellKey(store.coordinates.lat, store.coordinates.lng);
  io.to(room).emit('store:upserted', store);
  logger.info(`[Socket] store:upserted → ${room} (${store.id})`);
}

/** Broadcast a removed store to the cell it used to sit in. */
export function emitStoreRemoved(id: string, lat: number, lng: number): void {
  if (!io) return;
  const room = cellKey(lat, lng);
  io.to(room).emit('store:removed', { id });
  logger.info(`[Socket] store:removed → ${room} (${id})`);
}

export function emitNotificationToUser(userId: string, notification: NotificationEventPayload): void {
  if (!io) return;
  const room = notificationChannel(userId);
  io.to(room).emit('notification:new', notification);
  logger.info(`[Socket] notification:new → ${room} (${notification.id})`);
}

export function emitChatMessage(message: ChatMessagePayload): void {
  if (!io) return;
  const room = chatRoomKey(message.roomId);
  io.to(room).emit('chat:message', message);
  logger.info(`[Socket] chat:message → ${room} (${message.senderId})`);
}
