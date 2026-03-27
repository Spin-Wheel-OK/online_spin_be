import mongoose, { Document, Schema } from 'mongoose';
import { IParticipant } from '../types/index.js';

export interface IParticipantDocument extends IParticipant, Document {}

const ParticipantSchema: Schema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    hasWon: { type: Boolean, default: false },
    wonRound: { type: Number },
    wonPrize: { type: String },
  },
  { timestamps: true }
);

export const Participant = mongoose.model<IParticipantDocument>('Participant', ParticipantSchema);