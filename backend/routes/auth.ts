import { Request, Response, Router } from 'express';
import {
  buildFrontendRedirectUrl,
  buildMercadoLivreAuthUrlWithState,
  decodeFrontendState,
  encodeFrontendState,
  exchangeAuthCode,
  getValidToken,
  mercadoLivreRequest,
  toHttpError,
} from '../lib/mercadoLibre';
import { activateSession, createPendingSession, destroySession, requireSession } from '../lib/session';

const router = Router();

router.get('/login', async (req: Request, res: Response) => {
  try {
    const frontendUrl = typeof req.query.frontend_url === 'string' ? req.query.frontend_url.trim() : '';
    const session = await createPendingSession(frontendUrl);
    const state = encodeFrontendState({
      frontendUrl,
      sessionId: session.session_id,
    });

    res.json({ url: buildMercadoLivreAuthUrlWithState(state) });
  } catch (error) {
    const httpError = toHttpError(error, 'Unable to create the Mercado Livre authorization URL.');
    res.status(httpError.status).json({ error: httpError.message, details: httpError.details });
  }
});

router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const code = req.query.code as string;
  const statePayload = decodeFrontendState(typeof req.query.state === 'string' ? req.query.state : undefined);
  const frontendUrlFromState = statePayload?.frontendUrl;
  const sessionIdFromState = statePayload?.sessionId;

  if (!code) {
    res.status(400).json({ error: 'Authorization code was not provided by Mercado Livre.' });
    return;
  }

  try {
    const token = await exchangeAuthCode(code);
    const activeSession = await activateSession({
      sessionId: sessionIdFromState || `fallback-${token.user_id}`,
      sellerUserId: String(token.user_id),
      frontendUrl: frontendUrlFromState,
    });
    const redirectUrl = buildFrontendRedirectUrl(
      'success',
      undefined,
      frontendUrlFromState,
      activeSession.session_id
    );

    console.log(`Mercado Livre seller authenticated successfully. Seller ID: ${token.user_id}`);

    if (redirectUrl) {
      res.redirect(redirectUrl);
      return;
    }

    res.send('Seller authenticated successfully. You can return to the frontend.');
  } catch (error) {
    const httpError = toHttpError(error, 'Authentication with Mercado Livre failed.');
    const redirectUrl = buildFrontendRedirectUrl('error', httpError.message, frontendUrlFromState);

    console.error('Mercado Livre authentication error:', httpError.details ?? httpError.message);

    if (redirectUrl) {
      res.redirect(redirectUrl);
      return;
    }

    res.status(httpError.status).json({ error: httpError.message, details: httpError.details });
  }
});

router.get('/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await requireSession(req);
    const token = await getValidToken(session.seller_user_id);
    const seller = await mercadoLivreRequest<{
      id: number;
      nickname: string;
      email?: string;
      user_type?: string;
      points?: number;
    }>({
      method: 'GET',
      url: '/users/me',
      userId: session.seller_user_id,
    });

    res.json({
      authenticated: true,
      session_id: session.session_id,
      expires_at: token.expires_at,
      seller: {
        id: seller.id,
        nickname: seller.nickname,
        email: seller.email ?? '',
        user_type: seller.user_type ?? 'seller',
        points: seller.points ?? 0,
      },
    });
  } catch (error) {
    const httpError = toHttpError(error, 'Unable to load the seller session.');

    if (httpError.status === 401) {
      res.json({ authenticated: false });
      return;
    }

    res.status(httpError.status).json({ error: httpError.message, details: httpError.details });
  }
});

router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await requireSession(req);
    const token = await getValidToken(session.seller_user_id);
    const seller = await mercadoLivreRequest<{
      id: number;
      nickname: string;
      email?: string;
      user_type?: string;
      points?: number;
    }>({
      method: 'GET',
      url: '/users/me',
      userId: session.seller_user_id,
    });

    res.json({
      message: 'Seller data loaded successfully.',
      expires_at: token.expires_at,
      profile: {
        id: seller.id,
        nickname: seller.nickname,
        email: seller.email ?? '',
        user_type: seller.user_type ?? 'seller',
        points: seller.points ?? 0,
      },
    });
  } catch (error) {
    const httpError = toHttpError(error, 'Unable to load the seller profile.');
    res.status(httpError.status).json({ error: httpError.message, details: httpError.details });
  }
});

router.delete('/session', async (req: Request, res: Response): Promise<void> => {
  await destroySession(req);
  res.status(204).send();
});

export default router;
