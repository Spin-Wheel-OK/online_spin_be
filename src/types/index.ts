// Types for Spin Wheel System

export interface IRound {
  roundNumber: number;
  prize: string;
  prizeAmount: number;
  totalWinners: number;
  totalSpins: number;
  remainingSpins: number;
}

export interface IParticipant {
  id?: string;
  name: string;
  hasWon: boolean;
  wonRound?: number;
  wonPrize?: string;
}

export interface IWinner {
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
}

export interface AdminState {
  rounds: IRound[];
  participants: IParticipant[];
  winners: IWinner[];
  currentRound: number;
}

// Socket.IO event types
export interface ClientToServerEvents {
  'join-admin': () => void;
  'join-viewer': () => void;
  'spin-wheel': (data: SpinRequest) => void;
  'update-participants': (participants: IParticipant[]) => void;
  'update-rounds': (rounds: IRound[]) => void;
}

export interface ServerToClientEvents {
  'spin-start': (data: { roundNumber: number }) => void;
  'spin-result': (data: SpinResult) => void;
  'state-update': (data: AdminState) => void;
  'error': (message: string) => void;
}

export interface SocketData {
  role: 'admin' | 'viewer';
}