import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import Token, { IToken } from '../models/token';

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
  const token = userId
    ? await Token.findOne({ user_id: userId })
    : await Token.findOne().sort({ updatedAt: -1 });

  if (!token) {
    throw new HttpError(401, 'Authenticate a seller account before using Mercado Livre features.');
  }

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
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
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
  const frontendUrl = frontendUrlOverride || process.env.FRONTEND_URL || 'http://localhost:5173';

  if (!frontendUrl) {
    return null;
  }

  try {
    const redirectUrl = new URL(frontendUrl);
    redirectUrl.searchParams.set('auth', status);

    if (message) {
      redirectUrl.searchParams.set('message', message);
    }

    if (sessionId) {
      redirectUrl.searchParams.set('session_id', sessionId);
    }

    return redirectUrl.toString();
  } catch {
    return null;
  }
};
