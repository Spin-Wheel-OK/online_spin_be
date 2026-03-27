import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import { Round } from '../models/Round.js';
import { Participant } from '../models/Participant.js';
import { Winner } from '../models/Winner.js';
import { IRound, IParticipant, SpinRequest, SpinResult, AdminState, ClientToServerEvents, ServerToClientEvents } from '../types/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  }
}

// Default rounds data
const defaultRounds: IRound[] = [
  { roundNumber: 1, prize: '100,000 THB', prizeAmount: 100000, totalWinners: 1, totalSpins: 1, remainingSpins: 1 },
  { roundNumber: 2, prize: '30,000 THB', prizeAmount: 30000, totalWinners: 3, totalSpins: 3, remainingSpins: 3 },
  { roundNumber: 3, prize: '20,000 THB', prizeAmount: 20000, totalWinners: 5, totalSpins: 5, remainingSpins: 5 },
  { roundNumber: 4, prize: '10,000 THB', prizeAmount: 10000, totalWinners: 5, totalSpins: 5, remainingSpins: 5 },
  { roundNumber: 5, prize: '5,000 THB', prizeAmount: 5000, totalWinners: 10, totalSpins: 10, remainingSpins: 10 },
  { roundNumber: 6, prize: '2,000 THB', prizeAmount: 2000, totalWinners: 30, totalSpins: 30, remainingSpins: 30 },
];

export default async function apiRoutes(fastify: FastifyInstance) {
  // Get all rounds
  fastify.get('/rounds', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      let rounds = await Round.find().sort({ roundNumber: 1 });
      if (rounds.length === 0) {
        // Initialize default rounds
        await Round.insertMany(defaultRounds);
        rounds = await Round.find().sort({ roundNumber: 1 });
      }
      return reply.send(rounds);
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to fetch rounds' });
    }
  });

  // Get all participants
  fastify.get('/participants', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const participants = await Participant.find({ hasWon: false }).sort({ name: 1 });
      return reply.send(participants);
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to fetch participants' });
    }
  });

  // Add participants
  fastify.post('/participants', async (request: FastifyRequest<{ Body: IParticipant[] }>, reply: FastifyReply) => {
    try {
      const participants = request.body;
      await Participant.deleteMany({}); // Clear existing
      const result = await Participant.insertMany(participants);
      return reply.send(result);
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to add participants' });
    }
  });

  // Get winners
  fastify.get('/winners', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const winners = await Winner.find().sort({ roundNumber: 1, timestamp: -1 });
      return reply.send(winners);
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to fetch winners' });
    }
  });

  // Spin wheel
  fastify.post('/spin', async (request: FastifyRequest<{ Body: SpinRequest }>, reply: FastifyReply) => {
    try {
      const { roundNumber } = request.body;

      // Get round info
      const round = await Round.findOne({ roundNumber });
      if (!round) {
        return reply.status(404).send({ error: 'Round not found' });
      }

      if (round.remainingSpins <= 0) {
        return reply.status(400).send({ error: 'No remaining spins for this round' });
      }

      // Get available participants
      const participants = await Participant.find({ hasWon: false });
      if (participants.length === 0) {
        return reply.status(400).send({ error: 'No participants available' });
      }

      // Random select winner
      const randomIndex = Math.floor(Math.random() * participants.length);
      const winner = participants[randomIndex];

      // Generate spin result (0-360 degrees)
      const spinResult = Math.floor(Math.random() * 360);

      // Create winner record
      const winnerRecord = new Winner({
        roundNumber,
        participantId: winner.id,
        participantName: winner.name,
        prize: round.prize,
        prizeAmount: round.prizeAmount,
        spinResult,
      });
      await winnerRecord.save();

      // Update participant
      winner.hasWon = true;
      winner.wonRound = roundNumber;
      winner.wonPrize = round.prize;
      await winner.save();

      // Update round
      round.remainingSpins -= 1;
      await round.save();

      // Emit to all clients
      const io = fastify.io;
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

      return reply.send(result);
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to spin' });
    }
  });

  // Get admin state
  fastify.get('/admin-state', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rounds = await Round.find().sort({ roundNumber: 1 });
      const participants = await Participant.find({ hasWon: false });
      const winners = await Winner.find().sort({ roundNumber: 1, timestamp: -1 });

      const state: AdminState = {
        rounds: rounds.length > 0 ? rounds : defaultRounds,
        participants,
        winners,
        currentRound: 1,
      };

      return reply.send(state);
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to fetch admin state' });
    }
  });

  // Reset all data
  fastify.post('/reset', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await Round.deleteMany({});
      await Participant.deleteMany({});
      await Winner.deleteMany({});
      await Round.insertMany(defaultRounds);

      return reply.send({ message: 'Data reset successfully' });
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to reset data' });
    }
  });
}