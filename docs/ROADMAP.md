# Flux Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| 0 | RATIONALE + SUPPORTABILITY | Done |
| 1 | SPEC v0.1 | Done |
| 2 | L0/L1 runtime MVP (JSON + Protobuf unary, GET, APQ) | Done |
| 3 | Speed pack (compression, batch, benches) | Done |
| 4 | WebTransport L3 + SSE fallback + browser demo | Done |
| 5 | FlatBuffers L4 distinct codec (`FLFB`) | Done |
| 6 | Ecosystem (OpenAPI, lint, cookbook, Go server) | Done |
| — | ETag / If-None-Match | Done |
| — | OpenTelemetry `traceparent` propagation | Done |
| — | Strict APQ allowlist mode | Done |
| — | Real protobuf envelope wire format | Done |

| — | Production hardening (auth, limits, rate limit, CI) | Done (v0.2) |

## Follow-ups (post-v0.2)

1. Multi-instance rate limiting (Redis/edge)
2. Expand Go server to proto + streams
3. Formal security audit for regulated use
4. Publish `@flux/*` packages to npm with provenance
