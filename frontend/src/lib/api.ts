import axios, { AxiosHeaders } from 'axios';

const configuredBaseUrl = import.meta.env.VITE_API_URL?.trim();
export const SESSION_STORAGE_KEY = 'desafio_ml_session_id';
export const SESSION_HEADER_NAME = 'x-session-id';

export const API_BASE_URL = configuredBaseUrl
  ? configuredBaseUrl.replace(/\/$/, '')
  : 'http://localhost:3000/api';

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 45_000;
const RETRY_DELAY_MS = 1_200;

type RetriableConfig = {
  __retryCount?: number;
};

const delay = async (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

export const getSessionId = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }

  return window.localStorage.getItem(SESSION_STORAGE_KEY)?.trim() ?? '';
};

export const setSessionId = (sessionId: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId.trim());
};

export const clearSessionId = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(SESSION_STORAGE_KEY);
};

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
});

api.interceptors.request.use((config) => {
  const sessionId = getSessionId();
  const headers = config.headers;

  if (headers && typeof headers.set === 'function' && typeof headers.delete === 'function') {
    if (sessionId) {
      headers.set(SESSION_HEADER_NAME, sessionId);
    } else {
      headers.delete(SESSION_HEADER_NAME);
    }
  } else {
    config.headers = new AxiosHeaders({
      ...(config.headers ?? {}),
      ...(sessionId ? { [SESSION_HEADER_NAME]: sessionId } : {}),
    });
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as (typeof error.config & RetriableConfig) | undefined;

    if (!config) {
      throw error;
    }

    const retryCount = config.__retryCount ?? 0;
    const status = error.response?.status as number | undefined;
    const shouldRetry =
      retryCount < 1 && (
        !error.response ||
        RETRYABLE_STATUS_CODES.has(status ?? 0) ||
        error.code === 'ECONNABORTED'
      );

    if (!shouldRetry) {
      throw error;
    }

    config.__retryCount = retryCount + 1;
    await delay(RETRY_DELAY_MS);
    return api.request(config);
  }
);

export const getApiErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    if (error.message === 'Network Error' || error.code === 'ECONNABORTED') {
      return 'O backend pode estar acordando no Render. Aguarde alguns segundos e tente novamente.';
    }

    const responseMessage =
      typeof error.response?.data?.error === 'string' ? error.response.data.error : undefined;

    return responseMessage || error.message || 'Unexpected request error.';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected request error.';
};
