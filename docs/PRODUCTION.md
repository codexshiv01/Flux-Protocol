# Production deployment guide

Flux can be run in **development** (open defaults) or **production** mode (`productionOptions`).

## Production checklist

- [ ] TLS terminated at the edge (required for browsers / WebTransport)
- [ ] Prefer **HTTP/3** at the edge — see [HTTP/3 guide](./HTTP3.md) and `deploy/`
- [ ] Use `productionOptions({ schema, authenticate })`
- [ ] Clients: `idempotentReadResilience` (or custom retry/hedge) on safe GETs
- [ ] Implement real `authenticate` (JWT/session) — do **not** trust `Flux-Roles` alone
- [ ] Keep `strictApq: true` and preload allowlisted operations
- [ ] Set reverse-proxy body size limits to match `maxBodyBytes`
- [ ] Configure CDN caching only for idempotent GETs with short `select`/`op`
- [ ] Emit OpenTelemetry via `traceparent` from your gateway
- [ ] Run `npm test` / CI on every release

## Enable production mode

```ts
import { createServer } from "node:http";
import { parseFlux } from "@flux/idl";
import { FluxServer, createFluxHttpServer, productionOptions } from "@flux/runtime";

const schema = parseFlux(schemaSource);

const flux = new FluxServer(
  productionOptions({
    schema,
    authenticate: async (req) => {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) return null;
      // verify JWT / session here
      return { roles: ["user"], principal: "user-123" };
    },
  }),
);

flux.register("UserService", handlers);

// Preload APQ allowlist
// flux.apq.allow(opHash, select);

createServer(createFluxHttpServer(flux)).listen(8080);
```

## Defaults applied by `productionOptions`

| Setting | Default |
|---|---|
| `maxBodyBytes` | 1 MiB |
| `maxBatchSize` | 20 |
| `maxCost` / `maxDepth` | 500 / 12 |
| `strictApq` | true |
| `requireProtocolVersion` | true |
| `trustRoleHeader` | false |
| `rateLimit` | 600 req / minute / client IP |
| `enableFlatbuffers` | false |

## What “production-ready” means here

Flux **v0.3** provides the operational controls teams expect before putting an API on the public internet, plus HTTP/3 edge guidance and client-side resilience. You still own:

- Identity provider & secrets  
- Multi-instance rate limiting (use Redis/edge limits at scale)  
- Horizontal scaling / process supervision  
- Formal security audit for regulated industries  

## Testing

```bash
npm test
```

Includes production hardening tests: auth, body limits, strict APQ, batch caps, rate limits.
Also compression/dictionary and client resilience tests in `@flux/runtime`.

## Compression

`productionOptions` sets `autoCompress: true`. Clients that send `Accept-Encoding: zstd, br, gzip` get compressed responses above 512 bytes. Attach a schema dictionary for APQ-shaped JSON:

```ts
import { dictionaryFromSchema, productionOptions, FluxServer } from "@flux/runtime";

new FluxServer(productionOptions({
  schema,
  dictionary: dictionaryFromSchema(schema),
  authenticate,
}));
```
