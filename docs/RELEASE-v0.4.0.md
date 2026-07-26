# Flux Protocol v0.4.0

Typed RPC with field selection over plain HTTP — production-hardened TypeScript reference.

## Highlights

- **Client resilience** — deadlines, budgeted retries, request hedging, RFC 9218 `Priority`
- **HTTP/3 edge recipes** — Caddy / nginx Alt-Svc + 0-RTT guidance for idempotent GET
- **Smart compression** — zstd → br → gzip; skip tiny bodies; optional `dcz` dictionaries
- **WebTransport demo** — HTTPS + HTTP/3 on `127.0.0.1:4433` with `serverCertificateHashes`
- **Honest benches** — fair comparison vs REST / GraphQL / gRPC-like (`npm run bench:fair`)

## Install

```bash
git clone https://github.com/codexshiv01/Flux-Protocol.git
cd Flux-Protocol
npm install && npm run build
npm run example
```

## Docs

- [README](https://github.com/codexshiv01/Flux-Protocol#readme)
- [Changelog](https://github.com/codexshiv01/Flux-Protocol/blob/main/docs/CHANGELOG.md)
- [Specification](https://github.com/codexshiv01/Flux-Protocol/blob/main/docs/SPEC.md)
- [Production guide](https://github.com/codexshiv01/Flux-Protocol/blob/main/docs/PRODUCTION.md)

## Status

Open-source **v0.4 preview**. Suitable for evaluation and internal APIs with real auth/TLS. Not a formal audited 1.0.

**Full changelog:** [docs/CHANGELOG.md](https://github.com/codexshiv01/Flux-Protocol/blob/main/docs/CHANGELOG.md)
