import mongoose, { Schema, Document } from 'mongoose';

export interface IToken extends Document {
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  user_id: string;
}

const TokenSchema: Schema = new Schema({
  access_token: { type: String, required: true },
  refresh_token: { type: String, required: true },
  expires_at: { type: Date, required: true },
  user_id: { type: String, required: true, unique: true },
}, { timestamps: true });

export default mongoose.model<IToken>('Token', TokenSchema);