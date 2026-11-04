import { randomUUID } from 'crypto';
import type { Request } from 'express';
import AuthSession, { IAuthSession } from '../models/AuthSession';
import { HttpError, resolveFrontendUrl } from './mercadoLibre';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
export const SESSION_HEADER_NAME = 'x-session-id';

const buildSessionExpiry = () => new Date(Date.now() + SESSION_TTL_MS);

const PENDING_TTL_MS = 1000 * 60 * 10;

// Aceita só front-ends da lista permitida; qualquer outro valor vira o padrão.
const normalizeFrontendUrl = (value: string | null | undefined): string => resolveFrontendUrl(value);

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
    frontend_url: normalizeFrontendUrl(frontendUrl),
    status: 'pending',
    // Login pendente vale 10 minutos: tempo de autorizar no Mercado Livre.
    expires_at: new Date(Date.now() + PENDING_TTL_MS),
  });

  return session;
};

export const activateSession = async (params: {
  sessionId: string;
  sellerUserId: string;
  frontendUrl?: string | null;
}): Promise<IAuthSession> => {
  // Só ativa uma sessão que este servidor criou no /login, ainda pendente e dentro do prazo.
  // Sem upsert: um state forjado ou ausente não cria sessão nova.
  const session = await AuthSession.findOneAndUpdate(
    { session_id: params.sessionId, status: 'pending', expires_at: { $gt: new Date() } },
    {
      $set: {
        seller_user_id: params.sellerUserId,
        frontend_url: normalizeFrontendUrl(params.frontendUrl),
        status: 'authenticated',
        expires_at: buildSessionExpiry(),
        authenticated_at: new Date(),
        last_seen_at: new Date(),
      },
    },
    { new: true }
  );

  if (!session) {
    throw new HttpError(400, 'The login attempt expired or is invalid. Start the login again.');
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
