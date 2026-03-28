import mongoose, { Document, Schema } from 'mongoose';

export interface ISession {
  sessionNumber: number;
  name: string;
  createdAt?: Date;
}

export interface ISessionDocument extends ISession, Document {}

const SessionSchema: Schema = new Schema(
  {
    sessionNumber: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
  },
  { timestamps: true }
);

export const Session = mongoose.model<ISessionDocument>('Session', SessionSchema);
