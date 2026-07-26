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
| — | HTTP/3 edge recipe + Alt-Svc / 0-RTT guidance | Done (v0.3) |
| — | Client resilience (retry, hedge, budgets, deadlines) | Done (v0.3) |
| — | Smart zstd compression + size threshold | Done (v0.4) |
| — | Compression dictionaries (RFC 9842-style `dcz`) | Done (v0.4) |
| — | HTTPS WebTransport terminator demo | Done (v0.4) |

## Follow-ups (post-v0.4)

### Near-term (network & speed)

1. Client **connection pooling** under high RPS (multi H2/H3 conns)
2. L3 **promise pipelining** on WebTransport sessions
3. Adaptive codec from `WebTransport.getStats()` / RTT
4. CDN passthrough validation for `dcz` / `Available-Dictionary`

### Robustness & scale

5. Multi-instance rate limiting (Redis/edge)
6. Expand Go server to proto + streams + compression
7. Circuit breaker + per-procedure concurrency limits
8. Formal security audit for regulated use
9. Publish `@flux/*` packages to npm with provenance
