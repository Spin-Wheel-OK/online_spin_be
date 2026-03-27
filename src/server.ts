import Fastify, { FastifyInstance } from 'fastify';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import cors from '@fastify/cors';
import apiRoutes from './routes/api.js';
import { Round } from './models/Round.js';
import { Participant } from './models/Participant.js';
import { Winner } from './models/Winner.js';
import { ClientToServerEvents, ServerToClientEvents, SocketData, SpinResult } from './types/index.js';

// Load environment variables
dotenv.config();

// Initialize Fastify
const fastify: FastifyInstance = Fastify({ logger: true });

// Create HTTP server for Socket.IO
const httpServer = createServer(fastify.server);

// Initialize Socket.IO with types
const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, {}, SocketData>(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Store io in fastify for use in routes
fastify.decorate('io', io);

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

  // Join viewer room
  socket.on('join-viewer', () => {
    socket.join('viewer-room');
    socket.data.role = 'viewer';
    console.log('Viewer joined:', socket.id);
  });

  // Admin triggers spin via socket
  socket.on('spin-wheel', async (data) => {
    if (socket.data.role !== 'admin') {
      socket.emit('error', 'Unauthorized: only admin can spin');
      return;
    }

    try {
      const { roundNumber } = data;

      const round = await Round.findOne({ roundNumber });
      if (!round) {
        socket.emit('error', 'Round not found');
        return;
      }
      if (round.remainingSpins <= 0) {
        socket.emit('error', 'No remaining spins for this round');
        return;
      }

      const participants = await Participant.find({ hasWon: false });
      if (participants.length === 0) {
        socket.emit('error', 'No participants available');
        return;
      }

      const randomIndex = Math.floor(Math.random() * participants.length);
      const winner = participants[randomIndex];
      const spinResult = Math.floor(Math.random() * 360);

      const winnerRecord = new Winner({
        roundNumber,
        participantId: winner.id,
        participantName: winner.name,
        prize: round.prize,
        prizeAmount: round.prizeAmount,
        spinResult,
      });
      await winnerRecord.save();

      winner.hasWon = true;
      winner.wonRound = roundNumber;
      winner.wonPrize = round.prize;
      await winner.save();

      round.remainingSpins -= 1;
      await round.save();

      io.emit('spin-start', { roundNumber });

      const result: SpinResult = {
        winner: {
          roundNumber,
          participantId: winner.id,
          participantName: winner.name,
          prize: round.prize,
          prizeAmount: round.prizeAmount,
          spinResult,
          timestamp: new Date(),
        },
        remainingParticipants: await Participant.countDocuments({ hasWon: false }),
        remainingSpins: round.remainingSpins,
      };

      io.emit('spin-result', result);
    } catch (err) {
      console.error('spin-wheel error:', err);
      socket.emit('error', 'Spin failed');
    }
  });
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

    await fastify.ready();

    httpServer.listen(PORT, HOST, () => {
      console.log(`🚀 Server running on http://${HOST}:${PORT}`);
      console.log(`📡 Socket.IO enabled`);
      console.log(`🌐 API available at http://${HOST}:${PORT}/api`);
    });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();