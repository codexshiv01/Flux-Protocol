# Changelog

All notable changes to the Flux protocol and reference implementation.

## [0.4.0] — 2026-07-27

### Compression & WebTransport

- **Smart compression**: prefer zstd → br → gzip when `Accept-Encoding` allows; skip under 512 bytes (`autoCompress`, `compressThreshold`)
- **Shared dictionaries** (RFC 9842-style): `dictionaryFromSchema`, `GET /flux/dictionary`, `Content-Encoding: dcz`, client `Available-Dictionary` / `fetchDictionary`
- **WebTransport demo**: `examples/webtransport-demo` (HTTPS + optional Http3Server)
- Docs: `docs/WEBTRANSPORT.md`; HTTP/3 guide updated for compression

## [0.3.0] — 2026-07-27

### Network & client resilience

- Client **resilience**: deadlines (`Flux-Timeout-Ms`), exponential backoff retries, request **hedging**, **retry budgets**, RFC 9218 `Priority` header
- Presets: `idempotentReadResilience`, `hedgedReadResilience(delayMs)`
- HTTP/3 edge guide: [`docs/HTTP3.md`](./HTTP3.md)
- Deploy recipes: `deploy/caddy/Caddyfile`, `deploy/nginx/nginx-http3.conf` (Alt-Svc, early-data for GET only)

## [0.2.0] — 2026-07-27

### Production hardening

- `productionOptions()` preset (body limits, strict APQ, rate limits, protocol version required)
- `authenticate` hook; `trustRoleHeader: false` by default in production preset
- `maxBodyBytes`, `maxBatchSize`, in-memory rate limiter
- GitHub Actions CI (Node 20/22)
- Production guide: `docs/PRODUCTION.md`
- Expanded automated tests for auth, limits, APQ allowlist, rate limiting

## [0.1.1] — 2026-07-27

### Added / completed toward plan parity

- Real **protobuf wire** envelopes (`encodeProtoRequest` / `encodeProtoResponse`)
- Distinct **FlatBuffers-style L4** codec (`FLFB` magic)
- **ETag** + `If-None-Match` (304) on idempotent GET
- **OpenTelemetry** `traceparent` / `tracestate` propagation
- **Strict APQ** allowlist mode (`strictApq`)
- **Go** unary JSON server (`go/fluxserver`)
- Browser **demo** with fetch + SSE + WebTransport probe (`/demo`)
- Lossy-network benchmark methodology in BENCHMARKS.md

## [0.1.0] — 2026-07-27

### Added

- Protocol specification v0.1 (`Flux-Protocol-Version: 1`)
- Capability ladder L0–L4 (JSON, binary, GET+APQ, WebTransport, optional FlatBuffers)
- `@flux/idl` — parser, lint, breaking-change detection, TypeScript codegen, OpenAPI & Protobuf emit
- `@flux/runtime` — HTTP server/client, selection engine, APQ, batch, SSE & framed streams, compression
- `@flux/webtransport` — browser WT client helpers, session pump, SSE fallback
- `@flux/bench` — REST / GraphQL-like / RPC / Flux comparisons
- Example service `@flux/users-api` on port 8787
- Product documentation suite under `docs/`

### Notes

- v0.1 is intended for evaluation and early integration. Wire details may evolve additively before 1.0.
