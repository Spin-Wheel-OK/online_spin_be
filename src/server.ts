import Fastify, { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import cors from '@fastify/cors';
import apiRoutes from './routes/api.js';
import { Round } from './models/Round.js';
import { Participant } from './models/Participant.js';
import { Winner } from './models/Winner.js';
import { Session } from './models/Session.js';
import { ClientToServerEvents, ServerToClientEvents, SocketData, SpinResult } from './types/index.js';

// Load environment variables
dotenv.config();

// Initialize Fastify
const fastify: FastifyInstance = Fastify({ logger: true });

// Initialize Socket.IO — attach to fastify's underlying Node http.Server
const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, {}, SocketData>(fastify.server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Store io in fastify for use in routes
fastify.decorate('io', io);

// Expose spinActive setter for routes
fastify.decorate('setSpinActive', (val: boolean) => { spinActive = val; });
fastify.decorate('getSpinLock', () => spinLock);
fastify.decorate('setSpinLock', (val: boolean) => {
  spinLock = val;
  if (spinLockTimer) { clearTimeout(spinLockTimer); spinLockTimer = null; }
  if (val) {
    // Auto-release lock after 60s (safety net if spin-ended never arrives)
    spinLockTimer = setTimeout(() => { spinLock = false; spinActive = false; }, 60000);
  }
});

// MongoDB Connection
const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/spin-wheel');
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Track current state for new viewers
let currentSessionId: string | null = null;
let currentRoundInfo: { roundNumber: number; prize: string; prizeAmount: number } | null = null;
let spinActive = false; // Prevents duplicate spin-ended broadcasts
let spinLock = false;   // Prevents concurrent spins
let spinLockTimer: ReturnType<typeof setTimeout> | null = null;

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });

  // Join admin room
  socket.on('join-admin', () => {
    socket.join('admin-room');
    socket.data.role = 'admin';
    console.log('Admin joined:', socket.id);
  });

  // Join viewer room — send current state immediately
  socket.on('join-viewer', async () => {
    socket.join('viewer-room');
    socket.data.role = 'viewer';
    console.log('Viewer joined:', socket.id);

    // Send current session state
    if (currentSessionId) {
      try {
        const [participants, winners, rounds] = await Promise.all([
          Participant.find({ sessionId: currentSessionId, hasWon: false }).sort({ name: 1 }),
          Winner.find({ sessionId: currentSessionId }).sort({ timestamp: 1 }),
          Round.find({ sessionId: currentSessionId }).sort({ roundNumber: 1 }),
        ]);
        socket.emit('state-update', { rounds, participants, winners, currentRound: 1, sessionId: currentSessionId });
      } catch (err) {
        console.error('join-viewer state error:', err);
      }
    }
    // Send current round selection
    if (currentRoundInfo) {
      socket.emit('round-selected', currentRoundInfo);
    }
  });

  // Admin dismisses winner modal — broadcast to all clients
  socket.on('dismiss-winner', () => {
    io.emit('dismiss-winner');
  });

  // Viewer signals spin animation ended — only process the FIRST one per spin
  socket.on('spin-ended', async () => {
    if (!spinActive) return;
    spinActive = false;
    spinLock = false;
    if (spinLockTimer) { clearTimeout(spinLockTimer); spinLockTimer = null; }
    io.emit('spin-ended');

    // Broadcast updated state so winner list refreshes on all clients
    if (currentSessionId) {
      try {
        const [participants, winners, rounds] = await Promise.all([
          Participant.find({ sessionId: currentSessionId, hasWon: false }).sort({ name: 1 }),
          Winner.find({ sessionId: currentSessionId }).sort({ timestamp: 1 }),
          Round.find({ sessionId: currentSessionId }).sort({ roundNumber: 1 }),
        ]);
        io.emit('state-update', { rounds, participants, winners, currentRound: 1, sessionId: currentSessionId });
      } catch (err) {
        console.error('spin-ended broadcastState error:', err);
      }
    }
  });

  // Admin selects a session — broadcast session state to all viewers
  socket.on('select-session', async (data) => {
    currentSessionId = data.sessionId;
    currentRoundInfo = null;
    if (!data.sessionId) {
      io.emit('state-update', { rounds: [], participants: [], winners: [], currentRound: 1 });
      return;
    }
    try {
      const [participants, winners, rounds] = await Promise.all([
        Participant.find({ sessionId: data.sessionId, hasWon: false }).sort({ name: 1 }),
        Winner.find({ sessionId: data.sessionId }).sort({ timestamp: 1 }),
        Round.find({ sessionId: data.sessionId }).sort({ roundNumber: 1 }),
      ]);
      io.emit('state-update', { rounds, participants, winners, currentRound: 1, sessionId: data.sessionId });
    } catch (err) {
      console.error('select-session error:', err);
    }
  });

  // Admin selects a round — broadcast to all viewers
  socket.on('select-round', (data) => {
    currentRoundInfo = { roundNumber: data.roundNumber, prize: data.prize, prizeAmount: data.prizeAmount };
    io.emit('round-selected', currentRoundInfo);
  });

  // NOTE: spin-wheel via socket REMOVED — use HTTP POST /api/sessions/:id/spin instead
  // The HTTP path correctly handles sessionId, wheel segments, spin lock, etc.
});

// Register CORS (must be before routes)
fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
});

// Register API routes
fastify.register(apiRoutes, { prefix: '/api' });

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Start server
const start = async (): Promise<void> => {
  try {
    await connectDB();

    const PORT = parseInt(process.env.PORT || '3000', 10);
    const HOST = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port: PORT, host: HOST });

    console.log(`🚀 Server running on http://${HOST}:${PORT}`);
    console.log(`📡 Socket.IO enabled`);
    console.log(`🌐 API available at http://${HOST}:${PORT}/api`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();