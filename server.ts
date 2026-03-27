import Fastify, { FastifyInstance } from 'fastify';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import apiRoutes from './routes/api.js';
import { ClientToServerEvents, ServerToClientEvents, SocketData } from './types/index.js';

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