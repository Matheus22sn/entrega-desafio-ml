import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import Token, { IToken } from '../models/token';

// Tokens do Mercado Livre ficam cifrados no banco (AES-256-GCM).
// A chave vem de TOKEN_ENCRYPTION_KEY ou, se ela não existir, do ML_SECRET_KEY.
const ENCRYPTED_PREFIX = 'enc:v1:';

const encryptionKey = (): Buffer => {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.ML_SECRET_KEY;

  if (!secret) {
    throw new Error('Missing TOKEN_ENCRYPTION_KEY or ML_SECRET_KEY to encrypt tokens.');
  }

  return createHash('sha256').update(`ml-token:${secret}`).digest();
};

export const encryptSecret = (plain: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ENCRYPTED_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
};

export const decryptSecret = (stored: string): string => {
  // Tokens gravados antes da cifra continuam funcionando até o próximo refresh.
  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    return stored;
  }

  const raw = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
};

// Só redireciona para os front-ends configurados (FRONTEND_URL e CORS_ORIGIN).
export const allowedFrontendOrigins = (): string[] => {
  const values = [process.env.FRONTEND_URL, ...(process.env.CORS_ORIGIN ?? '').split(',')];
  const origins = values
    .map((value) => {
      try {
        return value ? new URL(value.trim()).origin : '';
      } catch {
        return '';
      }
    })
    .filter(Boolean);

  return origins.length > 0 ? Array.from(new Set(origins)) : ['http://localhost:5173'];
};

export const resolveFrontendUrl = (candidate?: string | null): string => {
  const allowed = allowedFrontendOrigins();

  if (candidate) {
    try {
      const origin = new URL(candidate.trim()).origin;

      if (allowed.includes(origin)) {
        return origin;
      }
    } catch {
      // URL inválida: cai no padrão abaixo.
    }
  }

  return allowed[0];
};

// Detalhes internos de erro só aparecem fora de produção.
export const publicDetails = (details: unknown): unknown =>
  process.env.NODE_ENV === 'production' ? undefined : details;

const ML_API_BASE_URL = 'https://api.mercadolibre.com';
const TOKEN_REFRESH_THRESHOLD_MS = 60_000;
const MAX_TRANSIENT_RETRIES = 2;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

type OAuthStatePayload = {
  frontendUrl?: string;
  sessionId?: string;
};

export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

const requireEnv = (key: string): string => {
  const value = process.env[key];

  if (!value) {
    throw new HttpError(500, `Missing required environment variable: ${key}`);
  }

  return value;
};

const buildTokenExpiry = (expiresIn: number): Date => {
  const expiresAt = new Date();
  expiresAt.setSeconds(expiresAt.getSeconds() + expiresIn);
  return expiresAt;
};

const extractErrorMessage = (details: unknown): string | undefined => {
  if (!details) {
    return undefined;
  }

  if (typeof details === 'string') {
    return details;
  }

  if (typeof details === 'object') {
    const maybeDetails = details as {
      error?: string;
      message?: string;
      cause?: Array<{ message?: string }>;
    };

    if (typeof maybeDetails.message === 'string' && maybeDetails.message.trim()) {
      return maybeDetails.message;
    }

    if (typeof maybeDetails.error === 'string' && maybeDetails.error.trim()) {
      return maybeDetails.error;
    }

    if (Array.isArray(maybeDetails.cause) && maybeDetails.cause.length > 0) {
      const firstCause = maybeDetails.cause[0];

      if (typeof firstCause?.message === 'string' && firstCause.message.trim()) {
        return firstCause.message;
      }
    }
  }

  return undefined;
};

export const toHttpError = (
  error: unknown,
  fallbackMessage = 'Unexpected error while communicating with Mercado Livre.'
): HttpError => {
  if (error instanceof HttpError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 500;
    const details = error.response?.data ?? error.message;
    const message = extractErrorMessage(details) ?? fallbackMessage;
    return new HttpError(status, message, details);
  }

  if (error instanceof Error) {
    return new HttpError(500, error.message);
  }

  return new HttpError(500, fallbackMessage);
};

const delay = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const shouldRetryRequest = (error: AxiosError, attempt: number): boolean => {
  if (attempt >= MAX_TRANSIENT_RETRIES) {
    return false;
  }

  const status = error.response?.status;

  if (status && RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }

  return !status;
};

const requestWithRetry = async <T>(
  requestFactory: () => Promise<T>,
  attempt = 0
): Promise<T> => {
  try {
    return await requestFactory();
  } catch (error) {
    if (axios.isAxiosError(error) && shouldRetryRequest(error, attempt)) {
      const retryAfterHeader = error.response?.headers?.['retry-after'];
      const retryDelay =
        typeof retryAfterHeader === 'string' && Number.isFinite(Number(retryAfterHeader))
          ? Number(retryAfterHeader) * 1000
          : 400 * 2 ** attempt;

      await delay(retryDelay);
      return requestWithRetry(requestFactory, attempt + 1);
    }

    throw error;
  }
};

const getStoredToken = async (userId?: string): Promise<IToken> => {
  // Sem vendedor identificado não há token: nunca usar o token de outro vendedor.
  const token = userId ? await Token.findOne({ user_id: userId }) : null;

  if (!token) {
    throw new HttpError(401, 'Authenticate a seller account before using Mercado Livre features.');
  }

  token.access_token = decryptSecret(token.access_token);
  token.refresh_token = decryptSecret(token.refresh_token);
  return token;
};

const shouldRefreshToken = (token: IToken): boolean => {
  return token.expires_at.getTime() - Date.now() <= TOKEN_REFRESH_THRESHOLD_MS;
};

const persistToken = async (payload: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string | number;
}): Promise<IToken> => {
  const userId = String(payload.user_id);
  const expiresAt = buildTokenExpiry(payload.expires_in);

  const token = await Token.findOneAndUpdate(
    { user_id: userId },
    {
      access_token: encryptSecret(payload.access_token),
      refresh_token: encryptSecret(payload.refresh_token),
      expires_at: expiresAt,
      user_id: userId,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  if (!token) {
    throw new HttpError(500, 'Unable to persist Mercado Livre token.');
  }

  // Devolve em claro só em memória, para a requisição atual.
  token.access_token = payload.access_token;
  token.refresh_token = payload.refresh_token;
  return token;
};

export const exchangeAuthCode = async (code: string): Promise<IToken> => {
  try {
    const payload = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: requireEnv('ML_APP_ID'),
      client_secret: requireEnv('ML_SECRET_KEY'),
      code,
      redirect_uri: requireEnv('ML_REDIRECT_URI'),
    });

    const response = await requestWithRetry(() =>
      axios.post(`${ML_API_BASE_URL}/oauth/token`, payload.toString(), {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
    );

    return persistToken(response.data);
  } catch (error) {
    throw toHttpError(error, 'Unable to exchange the authorization code.');
  }
};

export const refreshAccessToken = async (token: IToken): Promise<IToken> => {
  try {
    const payload = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: requireEnv('ML_APP_ID'),
      client_secret: requireEnv('ML_SECRET_KEY'),
      refresh_token: token.refresh_token,
    });

    const response = await requestWithRetry(() =>
      axios.post(`${ML_API_BASE_URL}/oauth/token`, payload.toString(), {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
    );

    return persistToken(response.data);
  } catch (error) {
    throw toHttpError(error, 'Unable to refresh the seller session.');
  }
};

export const getValidToken = async (userId?: string): Promise<IToken> => {
  const token = await getStoredToken(userId);

  if (!shouldRefreshToken(token)) {
    return token;
  }

  return refreshAccessToken(token);
};

export const mercadoLivreRequest = async <T>(
  config: AxiosRequestConfig & { userId?: string }
): Promise<T> => {
  const { userId, ...requestConfig } = config;
  const token = await getValidToken(userId);

  try {
    const response = await requestWithRetry(() =>
      axios.request<T>({
        ...requestConfig,
        baseURL: ML_API_BASE_URL,
        headers: {
          Accept: 'application/json',
          ...requestConfig.headers,
          Authorization: `Bearer ${token.access_token}`,
        },
      })
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const refreshedToken = await refreshAccessToken(token);

      const retriedResponse = await requestWithRetry(() =>
        axios.request<T>({
          ...requestConfig,
          baseURL: ML_API_BASE_URL,
          headers: {
            Accept: 'application/json',
            ...requestConfig.headers,
            Authorization: `Bearer ${refreshedToken.access_token}`,
          },
        })
      );

      return retriedResponse.data;
    }

    throw toHttpError(error);
  }
};

export const buildMercadoLivreAuthUrl = (): string => {
  const redirectUri = encodeURIComponent(requireEnv('ML_REDIRECT_URI'));
  const appId = requireEnv('ML_APP_ID');
  return `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${appId}&redirect_uri=${redirectUri}`;
};

export const buildMercadoLivreAuthUrlWithState = (state?: string): string => {
  const baseUrl = buildMercadoLivreAuthUrl();

  if (!state) {
    return baseUrl;
  }

  return `${baseUrl}&state=${encodeURIComponent(state)}`;
};

export const encodeFrontendState = (payload: OAuthStatePayload): string => {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
};

export const decodeFrontendState = (state?: string): OAuthStatePayload | null => {
  if (!state) {
    return null;
  }

  try {
    const parsedState = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as {
      frontendUrl?: unknown;
      sessionId?: unknown;
    };

    const frontendUrl =
      typeof parsedState.frontendUrl === 'string' && parsedState.frontendUrl.trim()
        ? parsedState.frontendUrl.trim()
        : undefined;
    const sessionId =
      typeof parsedState.sessionId === 'string' && parsedState.sessionId.trim()
        ? parsedState.sessionId.trim()
        : undefined;

    return {
      frontendUrl,
      sessionId,
    };
  } catch {
    return null;
  }
};

export const buildFrontendRedirectUrl = (
  status: 'success' | 'error',
  message?: string,
  frontendUrlOverride?: string | null,
  sessionId?: string
): string | null => {
  // Só front-ends da lista: impede redirecionar a sessão para um site de terceiros.
  const frontendUrl = resolveFrontendUrl(frontendUrlOverride);

  try {
    const redirectUrl = new URL(frontendUrl);
    redirectUrl.searchParams.set('auth', status);

    if (message) {
      redirectUrl.searchParams.set('message', message);
    }

    if (sessionId) {
      // No fragmento (#), a sessão não vai para logs de servidor nem para o Referer.
      redirectUrl.hash = new URLSearchParams({ session_id: sessionId }).toString();
    }

    return redirectUrl.toString();
  } catch {
    return null;
  }
};
