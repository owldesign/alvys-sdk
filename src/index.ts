import createClient, {
  type ClientOptions,
  type HeadersOptions,
} from 'openapi-fetch';
import type { paths } from './types/alvys';

const DEFAULT_BASE_URL = 'https://integrations.alvys.com';
const AUTH_TOKEN_URL = 'https://auth.alvys.com/oauth/token';
const PUBLIC_API_AUDIENCE = 'https://api.alvys.com/public/';
const TOKEN_DEFAULT_EXPIRES_IN_SECONDS = 60 * 60; // 60 minutes per docs
const TOKEN_EXPIRATION_BUFFER_MS = 60_000; // refresh 1 minute early

type MaybePromise<T> = T | Promise<T>;
type ValueOrFactory<T> = T | (() => MaybePromise<T>);
type HeaderInput = HeadersOptions;

const initClient = (options?: ClientOptions) => createClient<paths>(options);
type RawClient = ReturnType<typeof initClient>;

const isHeadersInstance = (value: unknown): value is Headers => typeof Headers !== 'undefined' && value instanceof Headers;

const mergeIntoHeaders = (target: Headers, source?: HeaderInput): void => {
  if (!source) {
    return;
  }

  if (isHeadersInstance(source)) {
    source.forEach((value, key) => target.set(key, value));
    return;
  }

  if (Array.isArray(source)) {
    source.forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      target.set(key, String(value));
    });
    return;
  }

  Object.entries(source).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    target.set(key, String(value));
  });
};

const headersToObject = (headers: Headers): Record<string, string> => {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
};

const resolveValue = async <T>(value?: ValueOrFactory<T>): Promise<T | undefined> => {
  if (typeof value === 'function') {
    return await (value as () => MaybePromise<T>)();
  }
  return value;
};

const getEnv = (key: string): string | undefined => {
  if (typeof process === 'undefined' || !process?.env) {
    return undefined;
  }
  return process.env[key];
};

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

interface TokenEndpointResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface CreateAlvysAccessTokenProviderOptions {
  clientId?: ValueOrFactory<string | undefined>;
  clientSecret?: ValueOrFactory<string | undefined>;
  audience?: string;
  scope?: string | string[];
  fetch?: typeof fetch;
  fallbackToken?: ValueOrFactory<string | undefined>;
  /** Override how early to refresh before the remote expiration. */
  expirationBufferMs?: number;
}

export const createAlvysAccessTokenProvider = (
  options: CreateAlvysAccessTokenProviderOptions = {}
) => {
  let cache: TokenCacheEntry | undefined;
  let inFlight: Promise<string> | undefined;

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const audience = options.audience ?? PUBLIC_API_AUDIENCE;
  const scope = Array.isArray(options.scope) ? options.scope.join(' ') : options.scope;
  const expirationBufferMs = options.expirationBufferMs ?? TOKEN_EXPIRATION_BUFFER_MS;

  const resolveFallbackToken = async () =>
    (await resolveValue(options.fallbackToken)) ?? getEnv('ALVYS_TOKEN');
  const resolveClientId = async () =>
    (await resolveValue(options.clientId)) ?? getEnv('ALVYS_CLIENT_ID');
  const resolveClientSecret = async () =>
    (await resolveValue(options.clientSecret)) ?? getEnv('ALVYS_CLIENT_SECRET');

  const requestToken = async (): Promise<string> => {
    if (typeof fetchImpl !== 'function') {
      throw new Error(
        'A fetch implementation is required to retrieve Alvys access tokens. Provide options.fetch or set a global fetch.'
      );
    }

    const [clientId, clientSecret] = await Promise.all([resolveClientId(), resolveClientSecret()]);
    if (!clientId || !clientSecret) {
      throw new Error(
        'Missing Alvys client credentials. Set ALVYS_CLIENT_ID/ALVYS_CLIENT_SECRET or pass clientId/clientSecret to createAlvysAccessTokenProvider().'
      );
    }

    const payload: Record<string, string> = {
      client_id: clientId,
      client_secret: clientSecret,
      audience,
      grant_type: 'client_credentials',
    };

    if (scope) {
      payload.scope = scope;
    }

    const response = await fetchImpl(AUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '<no body>');
      throw new Error(
        `Failed to retrieve Alvys access token (${response.status} ${response.statusText || ''}): ${errorText}`.trim()
      );
    }

    const data = (await response.json()) as TokenEndpointResponse;
    if (!data.access_token) {
      throw new Error('The Alvys token endpoint did not return an access_token.');
    }

    const expiresInSeconds =
      typeof data.expires_in === 'number' && data.expires_in > 0
        ? data.expires_in
        : TOKEN_DEFAULT_EXPIRES_IN_SECONDS;
    const ttlMs = Math.max(5_000, expiresInSeconds * 1000 - expirationBufferMs);
    cache = {
      token: data.access_token,
      expiresAt: Date.now() + ttlMs,
    };

    return data.access_token;
  };

  const getCachedToken = () => {
    if (cache && cache.expiresAt > Date.now()) {
      return cache.token;
    }
    return undefined;
  };

  return async (): Promise<string> => {
    const fallback = await resolveFallbackToken();
    if (fallback) {
      return fallback;
    }

    const cached = getCachedToken();
    if (cached) {
      return cached;
    }

    if (!inFlight) {
      inFlight = requestToken().finally(() => {
        inFlight = undefined;
      });
    }

    return await inFlight;
  };
};

export interface AlvysClientOptions {
  /** Override the default https://integrations.alvys.com base URL. */
  baseUrl?: string;
  /** Provide a custom fetch implementation (required in non-browser environments without global fetch). */
  fetch?: typeof fetch;
  /** Static or async bearer token. */
  accessToken?: ValueOrFactory<string | undefined>;
  /** Headers applied to every request before per-call headers. */
  defaultHeaders?: ValueOrFactory<HeaderInput>;
  /** Optional serializer overrides delegated to openapi-fetch. */
  querySerializer?: ClientOptions['querySerializer'];
  bodySerializer?: ClientOptions['bodySerializer'];
}

export type { paths, components, operations } from './types/alvys';

export const createAlvysClient = (options: AlvysClientOptions = {}) => {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'A fetch implementation is required. Install something like `undici` and pass it via options.fetch when using Node.js < 18.'
    );
  }

  const rawClient = initClient({
    baseUrl,
    fetch: fetchImpl,
    querySerializer: options.querySerializer,
    bodySerializer: options.bodySerializer,
  });

  const buildHeaders = async (requestHeaders?: HeaderInput): Promise<HeaderInput | undefined> => {
    const headers = new Headers();

    mergeIntoHeaders(headers, await resolveValue(options.defaultHeaders));

    const token = await resolveValue(options.accessToken);
    if (token) {
      headers.set('Authorization', token.startsWith('Bearer ') ? token : `Bearer ${token}`);
    }

    mergeIntoHeaders(headers, requestHeaders);

    let hasHeaders = false;
    headers.forEach(() => {
      hasHeaders = true;
    });

    return hasHeaders ? headersToObject(headers) : undefined;
  };

  const wrap = <K extends keyof RawClient>(method: K): RawClient[K] => {
    const fn = rawClient[method] as (...args: any[]) => Promise<any>;

    return (async (...args: any[]) => {
      if (args.length === 0) {
        throw new Error('An endpoint URL is required.');
      }

      const [url, options] = args as [any, Record<string, any> | undefined];
      const headers = await buildHeaders(options?.headers as HeaderInput | undefined);
      if (headers) {
        const nextOptions = { ...(options ?? {}), headers };
        return fn(url, nextOptions);
      }

      if (options === undefined) {
        return fn(url);
      }

      return fn(url, options);
    }) as RawClient[K];
  };

  return {
    baseUrl,
    fetch: fetchImpl,
    raw: rawClient,
    GET: wrap('GET'),
    PUT: wrap('PUT'),
    POST: wrap('POST'),
    PATCH: wrap('PATCH'),
    DELETE: wrap('DELETE'),
    OPTIONS: wrap('OPTIONS'),
    HEAD: wrap('HEAD'),
  } as const;
};

export type AlvysClient = ReturnType<typeof createAlvysClient>;
export const ALVYS_DEFAULT_BASE_URL = DEFAULT_BASE_URL;
export const ALVYS_AUTH_TOKEN_URL = AUTH_TOKEN_URL;
export const ALVYS_PUBLIC_API_AUDIENCE = PUBLIC_API_AUDIENCE;
