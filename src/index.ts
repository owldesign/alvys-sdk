import createClient, {
  type ClientOptions,
  type HeadersOptions,
} from 'openapi-fetch';
import type { paths } from './types/alvys';

const DEFAULT_BASE_URL = 'https://integrations.alvys.com';

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
