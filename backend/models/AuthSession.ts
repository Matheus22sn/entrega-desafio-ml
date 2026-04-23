import mongoose, { Document, Schema } from 'mongoose';

export interface IAuthSession extends Document {
  session_id: string;
  seller_user_id?: string;
  frontend_url?: string;
  status: 'pending' | 'authenticated' | 'expired';
  expires_at: Date;
  last_seen_at?: Date;
  authenticated_at?: Date;
}

const AuthSessionSchema: Schema = new Schema(
  {
    session_id: { type: String, required: true, unique: true },
    seller_user_id: { type: String },
    frontend_url: { type: String },
    status: {
      type: String,
      enum: ['pending', 'authenticated', 'expired'],
      default: 'pending',
      required: true,
    },
    expires_at: { type: Date, required: true },
    last_seen_at: { type: Date },
    authenticated_at: { type: Date },
  },
  { timestamps: true }
);

AuthSessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IAuthSession>('AuthSession', AuthSessionSchema);
