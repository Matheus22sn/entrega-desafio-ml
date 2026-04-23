import { randomUUID } from 'crypto';
import type { Request } from 'express';
import AuthSession, { IAuthSession } from '../models/AuthSession';
import { HttpError } from './mercadoLibre';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
export const SESSION_HEADER_NAME = 'x-session-id';

const buildSessionExpiry = () => new Date(Date.now() + SESSION_TTL_MS);

const normalizeFrontendUrl = (value: string | null | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value.trim());
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
};

export const getSessionIdFromRequest = (req: Request): string | null => {
  const headerValue = req.header(SESSION_HEADER_NAME);

  if (!headerValue || !headerValue.trim()) {
    return null;
  }

  return headerValue.trim();
};

export const createPendingSession = async (frontendUrl?: string | null): Promise<IAuthSession> => {
  const sessionId = randomUUID();
  const session = await AuthSession.create({
    session_id: sessionId,
    frontend_url: normalizeFrontendUrl(frontendUrl) ?? process.env.FRONTEND_URL ?? '',
    status: 'pending',
    expires_at: buildSessionExpiry(),
  });

  return session;
};

export const activateSession = async (params: {
  sessionId: string;
  sellerUserId: string;
  frontendUrl?: string | null;
}): Promise<IAuthSession> => {
  const normalizedFrontendUrl = normalizeFrontendUrl(params.frontendUrl);
  const session = await AuthSession.findOneAndUpdate(
    { session_id: params.sessionId },
    {
      $set: {
        seller_user_id: params.sellerUserId,
        frontend_url: normalizedFrontendUrl ?? process.env.FRONTEND_URL ?? '',
        status: 'authenticated',
        expires_at: buildSessionExpiry(),
        authenticated_at: new Date(),
        last_seen_at: new Date(),
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  if (!session) {
    throw new HttpError(500, 'Unable to activate the browser session.');
  }

  return session;
};

export const getOptionalSession = async (req: Request): Promise<IAuthSession | null> => {
  const sessionId = getSessionIdFromRequest(req);

  if (!sessionId) {
    return null;
  }

  const session = await AuthSession.findOne({ session_id: sessionId });

  if (!session) {
    return null;
  }

  if (session.expires_at.getTime() <= Date.now()) {
    if (session.status !== 'expired') {
      session.status = 'expired';
      await session.save();
    }

    return null;
  }

  if (session.status === 'authenticated') {
    session.last_seen_at = new Date();
    await session.save();
  }

  return session;
};

export const requireSession = async (
  req: Request
): Promise<IAuthSession & { seller_user_id: string }> => {
  const session = await getOptionalSession(req);

  if (!session || session.status !== 'authenticated' || !session.seller_user_id) {
    throw new HttpError(401, 'Authenticate a seller account in this browser session before using this feature.');
  }

  return session as IAuthSession & { seller_user_id: string };
};

export const destroySession = async (req: Request): Promise<void> => {
  const sessionId = getSessionIdFromRequest(req);

  if (!sessionId) {
    return;
  }

  await AuthSession.deleteOne({ session_id: sessionId });
};
