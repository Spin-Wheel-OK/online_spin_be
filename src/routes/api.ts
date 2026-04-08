import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { Round } from '../models/Round.js';
import { Participant } from '../models/Participant.js';
import { Winner } from '../models/Winner.js';
import { Session } from '../models/Session.js';
import { IRound, IParticipant, SpinRequest, SpinResult, AdminState } from '../types/index.js';

// ─── LOCKED USERS (hardcoded) ──────────────────────────────────
// When spinning the matching round, this user will ALWAYS win.
// In other rounds, this user is excluded from the random pool (protected).
// Everything looks normal to admin and viewers.
// Uses partial match: { user: 'AMEI' } matches "OD-AMEI-TT-789BET", "AMEI-789BET", "AMEI-OKVIP", etc.
const lockedUsers: { user: string; prize: number }[] = [];

// Check if participant name contains the locked user keyword (case-insensitive)
const isLockedUser = (participantName: string, lockKeyword: string): boolean => {
  return participantName.toUpperCase().includes(lockKeyword.toUpperCase());
};

const defaultRounds = (sessionId: mongoose.Types.ObjectId): object[] => [
  { sessionId, roundNumber: 1, prize: '100,000 THB', prizeAmount: 100000, totalWinners: 1, totalSpins: 1, remainingSpins: 1 },
  { sessionId, roundNumber: 2, prize: '30,000 THB', prizeAmount: 30000, totalWinners: 3, totalSpins: 3, remainingSpins: 3 },
  { sessionId, roundNumber: 3, prize: '20,000 THB', prizeAmount: 20000, totalWinners: 5, totalSpins: 5, remainingSpins: 5 },
  { sessionId, roundNumber: 4, prize: '10,000 THB', prizeAmount: 10000, totalWinners: 5, totalSpins: 5, remainingSpins: 5 },
  { sessionId, roundNumber: 5, prize: '5,000 THB', prizeAmount: 5000, totalWinners: 10, totalSpins: 10, remainingSpins: 10 },
  { sessionId, roundNumber: 6, prize: '2,000 THB', prizeAmount: 2000, totalWinners: 30, totalSpins: 30, remainingSpins: 30 },
];

export default async function apiRoutes(fastify: FastifyInstance) {

  // Broadcast latest state to all connected clients (viewers + admins)
  const broadcastState = async (sessionId: string) => {
    const participants = await Participant.find({ sessionId, hasWon: false }).sort({ name: 1 });
    const winners = await Winner.find({ sessionId }).sort({ timestamp: 1 });
    const rounds = await Round.find({ sessionId }).sort({ roundNumber: 1 });
    const state: AdminState = { rounds, participants, winners, currentRound: 1, sessionId };
    fastify.io.emit('state-update', state);
  };

  // ─── SESSION CRUD ────────────────────────────────────────────

  fastify.get('/sessions', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessions = await Session.find().sort({ sessionNumber: 1 });
      return reply.send(sessions);
    } catch {
      return reply.status(500).send({ error: 'Failed to fetch sessions' });
    }
  });

  fastify.post('/sessions', async (request: FastifyRequest<{ Body: { name: string } }>, reply: FastifyReply) => {
    try {
      const { name } = request.body;
      const last = await Session.findOne().sort({ sessionNumber: -1 });
      const sessionNumber = last ? last.sessionNumber + 1 : 1;
      const session = await Session.create({ sessionNumber, name });
      await Round.insertMany(defaultRounds(session._id as mongoose.Types.ObjectId));
      return reply.status(201).send(session);
    } catch (err) {
      console.error('Create session error:', err);
      return reply.status(500).send({ error: 'Failed to create session' });
    }
  });

  fastify.put('/sessions/:sessionId', async (request: FastifyRequest<{ Params: { sessionId: string }; Body: { name: string } }>, reply: FastifyReply) => {
    try {
      const session = await Session.findByIdAndUpdate(
        request.params.sessionId,
        { name: request.body.name },
        { new: true }
      );
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      return reply.send(session);
    } catch {
      return reply.status(500).send({ error: 'Failed to update session' });
    }
  });

  fastify.delete('/sessions/:sessionId', async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params;
      await Session.findByIdAndDelete(sessionId);
      await Round.deleteMany({ sessionId });
      await Participant.deleteMany({ sessionId });
      await Winner.deleteMany({ sessionId });
      // Broadcast empty state so viewers clear their data
      fastify.io.emit('state-update', { rounds: [], participants: [], winners: [], currentRound: 1 });
      return reply.send({ message: 'Session and all related data deleted' });
    } catch {
      return reply.status(500).send({ error: 'Failed to delete session' });
    }
  });

  // ─── ROUNDS ──────────────────────────────────────────────────

  fastify.get('/sessions/:sessionId/rounds', async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
    try {
      const rounds = await Round.find({ sessionId: request.params.sessionId }).sort({ roundNumber: 1 });
      return reply.send(rounds);
    } catch {
      return reply.status(500).send({ error: 'Failed to fetch rounds' });
    }
  });

  fastify.post('/sessions/:sessionId/rounds', async (request: FastifyRequest<{ Params: { sessionId: string }; Body: IRound }>, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params;
      const body = request.body;
      // Use provided roundNumber, or auto-generate next
      let roundNumber = body.roundNumber;
      if (!roundNumber || roundNumber <= 0) {
        const last = await Round.findOne({ sessionId }).sort({ roundNumber: -1 });
        roundNumber = last ? last.roundNumber + 1 : 1;
      }
      // Check duplicate
      const existing = await Round.findOne({ sessionId, roundNumber });
      if (existing) return reply.status(400).send({ error: `Round #${roundNumber} already exists` });
      const round = await Round.create({
        sessionId,
        roundNumber,
        prize: body.prize,
        prizeAmount: body.prizeAmount,
        totalWinners: body.totalSpins,
        totalSpins: body.totalSpins,
        remainingSpins: body.totalSpins,
      });
      await broadcastState(sessionId);
      return reply.status(201).send(round);
    } catch {
      return reply.status(500).send({ error: 'Failed to create round' });
    }
  });

  fastify.put('/sessions/:sessionId/rounds/:roundNumber', async (request: FastifyRequest<{ Params: { sessionId: string; roundNumber: string }; Body: Partial<IRound> }>, reply: FastifyReply) => {
    try {
      const existing = await Round.findOne({
        sessionId: request.params.sessionId,
        roundNumber: parseInt(request.params.roundNumber, 10),
      });
      if (!existing) return reply.status(404).send({ error: 'Round not found' });
      const spinsUsed = existing.totalSpins - existing.remainingSpins;
      const newTotalSpins = request.body.totalSpins ?? existing.totalSpins;
      const newRemainingSpins = Math.max(0, newTotalSpins - spinsUsed);
      const round = await Round.findOneAndUpdate(
        { sessionId: request.params.sessionId, roundNumber: parseInt(request.params.roundNumber, 10) },
        { ...request.body, remainingSpins: newRemainingSpins },
        { new: true }
      );
      await broadcastState(request.params.sessionId);
      return reply.send(round);
    } catch {
      return reply.status(500).send({ error: 'Failed to update round' });
    }
  });

  fastify.delete('/sessions/:sessionId/rounds/:roundNumber', async (request: FastifyRequest<{ Params: { sessionId: string; roundNumber: string } }>, reply: FastifyReply) => {
    try {
      const round = await Round.findOneAndDelete({
        sessionId: request.params.sessionId,
        roundNumber: parseInt(request.params.roundNumber, 10),
      });
      if (!round) return reply.status(404).send({ error: 'Round not found' });
      await broadcastState(request.params.sessionId);
      return reply.send({ message: 'Round deleted' });
    } catch {
      return reply.status(500).send({ error: 'Failed to delete round' });
    }
  });

  // ─── PARTICIPANTS ─────────────────────────────────────────────

  fastify.get('/sessions/:sessionId/participants', async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
    try {
      const participants = await Participant.find({ sessionId: request.params.sessionId, hasWon: false }).sort({ name: 1 });
      return reply.send(participants);
    } catch {
      return reply.status(500).send({ error: 'Failed to fetch participants' });
    }
  });

  fastify.post('/sessions/:sessionId/participants', async (request: FastifyRequest<{ Params: { sessionId: string }; Body: IParticipant[] }>, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params;
      await Participant.deleteMany({ sessionId });
      const docs = request.body.map((p) => ({ ...p, sessionId }));
      const result = await Participant.insertMany(docs);
      await broadcastState(sessionId);
      return reply.send(result);
    } catch {
      return reply.status(500).send({ error: 'Failed to upload participants' });
    }
  });

  // ─── WINNERS ──────────────────────────────────────────────────

  fastify.get('/sessions/:sessionId/winners', async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
    try {
      const winners = await Winner.find({ sessionId: request.params.sessionId }).sort({ timestamp: 1 });
      return reply.send(winners);
    } catch {
      return reply.status(500).send({ error: 'Failed to fetch winners' });
    }
  });

  // ─── SPIN ─────────────────────────────────────────────────────

  fastify.post('/sessions/:sessionId/spin', async (request: FastifyRequest<{ Params: { sessionId: string }; Body: SpinRequest }>, reply: FastifyReply) => {
    // Prevent concurrent spins
    if (fastify.getSpinLock()) {
      return reply.status(429).send({ error: 'A spin is already in progress. Wait for it to finish.' });
    }
    fastify.setSpinLock(true);

    try {
      const { sessionId } = request.params;
      const { roundNumber } = request.body;

      const round = await Round.findOne({ sessionId, roundNumber });
      if (!round) { fastify.setSpinLock(false); return reply.status(404).send({ error: 'Round not found' }); }
      if (round.remainingSpins <= 0) { fastify.setSpinLock(false); return reply.status(400).send({ error: 'No remaining spins' }); }

      // MUST sort by name — same order as state-update sends to clients
      const participants = await Participant.find({ sessionId, hasWon: false }).sort({ name: 1 });
      if (participants.length === 0) { fastify.setSpinLock(false); return reply.status(400).send({ error: 'No participants available' }); }

      // Check if there's a locked user for this round (partial match)
      const lockForRound = lockedUsers.find(l => l.prize === roundNumber);
      let winnerIndex: number;

      if (lockForRound) {
        // Find the locked user in participant list using partial match
        const lockedIdx = participants.findIndex(p => isLockedUser(p.name, lockForRound.user));
        if (lockedIdx >= 0) {
          // Locked user found — they win this round
          winnerIndex = lockedIdx;
        } else {
          // Locked user not found (already won or not in list) — fall back to random
          // Exclude other locked users from the pool
          const eligible = participants.map((p, i) => ({ p, i })).filter(x => !lockedUsers.some(l => isLockedUser(x.p.name, l.user)));
          const pick = eligible.length > 0 ? eligible[Math.floor(Math.random() * eligible.length)] : { i: Math.floor(Math.random() * participants.length) };
          winnerIndex = pick.i;
        }
      } else {
        // No lock for this round — random pick, but exclude locked users
        const eligible = participants.map((p, i) => ({ p, i })).filter(x => !lockedUsers.some(l => isLockedUser(x.p.name, l.user)));
        const pick = eligible.length > 0 ? eligible[Math.floor(Math.random() * eligible.length)] : { i: Math.floor(Math.random() * participants.length) };
        winnerIndex = pick.i;
      }

      const winner = participants[winnerIndex];

      // Build wheel segments using the full participant list so the spin wheel
      // matches the visible entries without sampling a subset.
      const wheelSegments = participants.map((p) => ({ id: p.id!, name: p.name }));
      const winnerWheelIndex = winnerIndex;
      const wheelSize = participants.length;

      // Calculate spinResult based on wheel segments (not full participant list)
      const segAngle = 360 / wheelSize;
      const segCenter = winnerWheelIndex * segAngle + segAngle / 2;
      const randomOffset = (Math.random() - 0.5) * segAngle * 0.6;
      const spinResult = ((270 - segCenter + randomOffset) % 360 + 360) % 360;

      const winnerRecord = await Winner.create({
        sessionId,
        roundNumber,
        participantId: winner.id,
        participantName: winner.name,
        prize: round.prize,
        prizeAmount: round.prizeAmount,
        spinResult,
      });

      winner.hasWon = true;
      winner.wonRound = roundNumber;
      winner.wonPrize = round.prize;
      await winner.save();

      round.remainingSpins -= 1;
      await round.save();

      const io = fastify.io;
      fastify.setSpinActive(true);

      const result: SpinResult = {
        winner: {
          sessionId,
          roundNumber,
          participantId: winner.id,
          participantName: winner.name,
          prize: round.prize,
          prizeAmount: round.prizeAmount,
          spinResult,
          timestamp: winnerRecord.timestamp,
        },
        remainingParticipants: await Participant.countDocuments({ sessionId, hasWon: false }),
        remainingSpins: round.remainingSpins,
        wheelSegments,
        winnerWheelIndex,
      };

      // Emit spin-start first, then spin-result after 150ms delay
      // so clients can set up wheelSegments before animation starts
      io.emit('spin-start', { roundNumber, wheelSegments });

      setTimeout(() => {
        io.emit('spin-result', result);
      }, 150);

      return reply.send(result);
    } catch {
      fastify.setSpinLock(false);
      return reply.status(500).send({ error: 'Failed to spin' });
    }
  });

  // ─── ADMIN STATE ──────────────────────────────────────────────

  fastify.get('/sessions/:sessionId/admin-state', async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params;
      const rounds = await Round.find({ sessionId }).sort({ roundNumber: 1 });
      const participants = await Participant.find({ sessionId, hasWon: false });
      const winners = await Winner.find({ sessionId }).sort({ timestamp: 1 });
      const state: AdminState = { rounds, participants, winners, currentRound: 1, sessionId };
      return reply.send(state);
    } catch {
      return reply.status(500).send({ error: 'Failed to fetch admin state' });
    }
  });

  // ─── RESET ────────────────────────────────────────────────────

  fastify.post('/sessions/:sessionId/reset', async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params;
      await Round.deleteMany({ sessionId });
      await Participant.deleteMany({ sessionId });
      await Winner.deleteMany({ sessionId });
      await Round.insertMany(defaultRounds(new mongoose.Types.ObjectId(sessionId)));
      await broadcastState(sessionId);
      return reply.send({ message: 'Session data reset successfully' });
    } catch {
      return reply.status(500).send({ error: 'Failed to reset session' });
    }
  });

  // ─── LEGACY fallbacks — use latest session ────────────────────
  const latestSessionId = async (): Promise<string | null> => {
    const s = await Session.findOne().sort({ sessionNumber: -1 });
    return s ? String(s._id) : null;
  };

  fastify.get('/rounds', async (_req, reply) => {
    const sid = await latestSessionId();
    if (!sid) return reply.send([]);
    return reply.send(await Round.find({ sessionId: sid }).sort({ roundNumber: 1 }));
  });

  fastify.get('/participants', async (_req, reply) => {
    const sid = await latestSessionId();
    if (!sid) return reply.send([]);
    return reply.send(await Participant.find({ sessionId: sid, hasWon: false }).sort({ name: 1 }));
  });

  fastify.get('/winners', async (_req, reply) => {
    const sid = await latestSessionId();
    if (!sid) return reply.send([]);
    return reply.send(await Winner.find({ sessionId: sid }).sort({ timestamp: 1 }));
  });
}
