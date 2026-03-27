import mongoose, { Document, Schema } from 'mongoose';
import { IRound } from '../types/index.js';

export interface IRoundDocument extends IRound, Document {}

const RoundSchema: Schema = new Schema(
  {
    roundNumber: { type: Number, required: true, unique: true },
    prize: { type: String, required: true },
    prizeAmount: { type: Number, required: true },
    totalWinners: { type: Number, required: true },
    totalSpins: { type: Number, required: true },
    remainingSpins: { type: Number, required: true },
  },
  { timestamps: true }
);

export const Round = mongoose.model<IRoundDocument>('Round', RoundSchema);