import mongoose, { Document, Schema } from 'mongoose';
import { IParticipant } from '../types/index.js';

export interface IParticipantDocument extends Omit<IParticipant, 'id'>, Document {}

const ParticipantSchema: Schema = new Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    id: { type: String, required: true },
    name: { type: String, required: true },
    hasWon: { type: Boolean, default: false },
    wonRound: { type: Number },
    wonPrize: { type: String },
  },
  { timestamps: true }
);

export const Participant = mongoose.model<IParticipantDocument>('Participant', ParticipantSchema);
