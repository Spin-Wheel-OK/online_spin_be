import mongoose, { Document, Schema } from 'mongoose';
import { IWinner } from '../types/index.js';

export interface IWinnerDocument extends IWinner, Document {}

const WinnerSchema: Schema = new Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    roundNumber: { type: Number, required: true },
    participantId: { type: String, required: true },
    participantName: { type: String, required: true },
    prize: { type: String, required: true },
    prizeAmount: { type: Number, required: true },
    spinResult: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Winner = mongoose.model<IWinnerDocument>('Winner', WinnerSchema);
