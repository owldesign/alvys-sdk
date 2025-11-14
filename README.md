# Alvys REST API

Typed, ESM-first JavaScript/TypeScript client for the [Alvys REST API](https://docs.alvys.com/reference), generated directly from the public OpenAPI specification.

## Features
- **Dual ESM/CJS builds** with bundled declaration files targeting ES2020 runtimes.
- **Typed client** built on [`openapi-fetch`](https://github.com/drwpow/openapi-fetch) covering every endpoint from the latest spec.
- **Configurable auth & headers** via `createAlvysClient()` options.
- **Zero runtime dependencies** beyond the Fetch API; bring your own `fetch` in Node.js environments.

## Installation
```sh
npm install alvys-sdk
# or yarn/pnpm/bun
```

## Usage
```ts
import { createAlvysClient } from 'alvys-sdk';

const alvys = createAlvysClient({
  accessToken: async () => {
    // fetch a token via your auth flow
    return process.env.ALVYS_TOKEN!;
  },
});

const response = await alvys.POST('/api/s/v1/shipments', {
  body: {
    shipmentNumber: 'SH-1001',
    // ...rest of the typed payload
  },
});

if (response.data) {
  console.log('Shipment:', response.data);
} else {
  console.error('API error:', response.error);
}
```

## Token helper

Tokens issued by `https://auth.alvys.com/oauth/token` expire after 60 minutes. The SDK now ships a helper that caches and refreshes them automatically while keeping the `.env` fallback for manually generated tokens.

```ts
import { createAlvysAccessTokenProvider, createAlvysClient } from 'alvys-sdk';

const getAccessToken = createAlvysAccessTokenProvider({
  clientId: process.env.ALVYS_CLIENT_ID!,
  clientSecret: process.env.ALVYS_CLIENT_SECRET!,
  // Optional: scope, custom audience, or fetch implementation
});

const alvys = createAlvysClient({
  accessToken: getAccessToken,
});
```

`createAlvysAccessTokenProvider()`
- Caches the last token and refreshes it one minute before expiration.
- Uses the official audience `https://api.alvys.com/public/` by default.
- Falls back to `process.env.ALVYS_TOKEN` when no client credentials are available.
- Accepts async `clientId`/`clientSecret`/`fallbackToken` factories plus a custom `fetch` implementation if needed.

### Endpoint examples (Drivers, Loads, Trucks, Trailers)
Each helper returns the typed response from the OpenAPI spec. Path params (such as `{version}`) are passed via `params.path`, while filters go in `params.query`, and search payloads are fully typed via the exported `components` schema map.

#### Drivers
```ts
import { createAlvysClient, type components } from 'alvys-sdk';

const alvys = createAlvysClient();

const drivers = await alvys.GET('/api/p/v{version}/drivers', {
  params: { path: { version: '1' } },
});

const driverSearch = await alvys.POST('/api/p/v{version}/drivers/search', {
  params: { path: { version: '1' } },
  body: {
    Page: 1,
    PageSize: 25,
    Status: ['Active'],
    Name: 'Smith',
  } satisfies components['schemas']['Alvys.Models.Users.DriverSearchRequest'],
});

if (driverSearch.data) {
  driverSearch.data.Items.forEach(driver => console.log(driver.Name));
}
```

#### Loads
```ts
const loadByNumber = await alvys.GET('/api/p/v{version}/loads', {
  params: {
    path: { version: '2' },
    query: { loadNumber: 'L-10001' },
  },
});

const loadSearch = await alvys.POST('/api/p/v{version}/loads/search', {
  params: { path: { version: '2' } },
  body: {
    Page: 1,
    PageSize: 50,
    Status: ['Dispatched', 'Delivered'],
    DateRange: {
      Start: '2024-01-01T00:00:00Z',
      End: '2024-01-31T23:59:59Z',
    },
    IncludeDeleted: false,
  } satisfies components['schemas']['Alvys.Models.Loads.LoadSearchRequest'],
});
```

#### Trucks
```ts
const trucks = await alvys.GET('/api/p/v{version}/trucks', {
  params: { path: { version: '1' } },
});

const truckSearch = await alvys.POST('/api/p/v{version}/trucks/search', {
  params: { path: { version: '1' } },
  body: {
    Page: 1,
    PageSize: 25,
    TruckNumber: '1205',
    Status: ['Active'],
  } satisfies components['schemas']['Alvys.Models.Users.TruckSearchRequest'],
});
```

#### Trailers
```ts
const trailer = await alvys.GET('/api/p/v{version}/trailers/{id}', {
  params: {
    path: { version: '1', id: 'uuid-of-trailer' },
  },
});

const trailerSearch = await alvys.POST('/api/p/v{version}/trailers/search', {
  params: { path: { version: '1' } },
  body: {
    Page: 1,
    PageSize: 25,
    TrailerNumber: 'TR-4200',
    Status: ['Active'],
  } satisfies components['schemas']['Alvys.Models.Trailers.TrailerSearchRequest'],
});
```

### Node.js
This SDK expects a global Fetch API. Node 18+ exposes `fetch`/`Headers` natively. For older versions, install a polyfill such as [`undici`](https://github.com/nodejs/undici):

```ts
import { fetch, Headers, Request, Response } from 'undici';

globalThis.fetch = fetch;
globalThis.Headers = Headers;
globalThis.Request = Request;
globalThis.Response = Response;
```

Alternatively, pass the implementation explicitly:

```ts
import { fetch as undiciFetch } from 'undici';

const alvys = createAlvysClient({ fetch: undiciFetch });
```

### Custom headers & base URL
```ts
const alvys = createAlvysClient({
  baseUrl: 'https://integrations.alvys.com',
  accessToken: () => getTokenFromSomewhere(),
  defaultHeaders: async () => ({
    'x-my-app-version': '1.2.3',
  }),
});
```
Per-request headers (including overriding `Authorization`) can still be supplied via the second argument to `GET/POST/...` calls.

## API typings
All OpenAPI types live in `src/types/alvys.ts`. You can import any of them:
```ts
import type { paths } from 'alvys-sdk';
```

## Local development
- `npm run generate` – regenerate `src/types/alvys.ts` from the public swagger document.
- `npm run build` – produce the dual ESM/CJS bundle in `dist/`.
- `npm run dev` – watch-mode build via `tsup`.

The generated types are committed so the SDK can be used without running the generator, but make sure to re-run it before publishing when the upstream API changes.
