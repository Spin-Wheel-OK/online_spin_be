import { Server as SocketIOServer } from 'socket.io';

// Augment Fastify with Socket.IO
declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
    setSpinActive: (val: boolean) => void;
    getSpinLock: () => boolean;
    setSpinLock: (val: boolean) => void;
  }
}

// Types for Spin Wheel System

export interface ISession {
  _id?: string;
  sessionNumber: number;
  name: string;
  createdAt?: Date;
}

export interface IRound {
  sessionId?: string;
  roundNumber: number;
  prize: string;
  prizeAmount: number;
  totalWinners: number;
  totalSpins: number;
  remainingSpins: number;
}

export interface IParticipant {
  sessionId?: string;
  id?: string;
  name: string;
  hasWon: boolean;
  wonRound?: number;
  wonPrize?: string;
}

export interface IWinner {
  sessionId?: string;
  roundNumber: number;
  participantId: string;
  participantName: string;
  prize: string;
  prizeAmount: number;
  spinResult: number; // 0-360 degrees
  timestamp: Date;
}

export interface SpinRequest {
  roundNumber: number;
}

export interface SpinResult {
  winner: IWinner;
  remainingParticipants: number;
  remainingSpins: number;
  wheelSegments: { id: string; name: string }[];
  winnerWheelIndex: number;
}

export interface AdminState {
  rounds: IRound[];
  participants: IParticipant[];
  winners: IWinner[];
  currentRound: number;
  sessionId?: string;
}

// Socket.IO event types
export interface ClientToServerEvents {
  'join-admin': () => void;
  'join-viewer': () => void;
  'spin-wheel': (data: SpinRequest) => void;
  'update-participants': (participants: IParticipant[]) => void;
  'update-rounds': (rounds: IRound[]) => void;
  'select-round': (data: { roundNumber: number; prize: string; prizeAmount: number }) => void;
  'select-session': (data: { sessionId: string | null }) => void;
  'spin-ended': () => void;
  'dismiss-winner': () => void;
  'welcome-mode': (data: { enabled: boolean }) => void;
}

export interface ServerToClientEvents {
  'spin-start': (data: { roundNumber: number; wheelSegments?: { id: string; name: string }[] }) => void;
  'spin-result': (data: SpinResult) => void;
  'state-update': (data: AdminState) => void;
  'round-selected': (data: { roundNumber: number; prize: string; prizeAmount: number }) => void;
  'spin-ended': () => void;
  'dismiss-winner': () => void;
  'error': (message: string) => void;
  'welcome-mode': (data: { enabled: boolean }) => void;
}

export interface SocketData {
  role: 'admin' | 'viewer';
}