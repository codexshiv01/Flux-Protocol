# Flux Protocol

**One API protocol for reach, efficiency, and modern clients.**

Flux combines the universality of **HTTP**, the typed procedures and streams of **gRPC**, and the precise field selection of **GraphQL** — without forcing you to run three stacks.

[Documentation](./docs/README.md) · [Getting Started](./docs/getting-started.md) · [Compare protocols](./docs/comparison.md) · [Benchmarks](./docs/BENCHMARKS.md) · [Specification](./docs/SPEC.md)

---

## Why Flux

| Pain today | Flux answer |
|---|---|
| REST over-fetches; GraphQL adds another stack | Selection sets on every procedure |
| gRPC breaks at browsers / some CDNs | Plain HTTP, errors in the body, curl day one |
| GraphQL POST fights CDN caching | Idempotent GET + APQ + `Cache-Control` |
| Three schemas drift apart | One `.flux` → TS, OpenAPI, Protobuf |
| Browser bi-di is awkward | WebTransport path + SSE fallback |

Read the full story: [Introduction](./docs/introduction.md) · [Comparison](./docs/comparison.md)

---

## Quick start

```bash
npm install
npm run build
npm run example
```

```bash
curl.exe -sS http://localhost:8787/health
```

```powershell
Set-Content tmp-req.json '{"input":{"id":"u_1"},"select":{"id":true,"name":true,"posts":{"title":true}}}'
curl.exe -sS -X POST "http://localhost:8787/flux.v1.UserService/GetUser" `
  -H "Content-Type: application/flux+json" `
  -H "Flux-Protocol-Version: 1" `
  --data-binary "@tmp-req.json"
```

---

## Capability ladder

| Tier | Path | Role |
|---|---|---|
| L0 | HTTP/1.1 + JSON | Universal (required) |
| L1 | Binary + compression | Production default |
| L2 | GET + APQ + cache | CDN edge reads |
| L3 | WebTransport | Browser bi-di / datagrams |
| L4 | FlatBuffers (optional) | Internal turbo |

---

## Repository

| Path | Purpose |
|---|---|
| [`docs/`](./docs/README.md) | Product & protocol documentation |
| [`schema/`](./schema/user.flux) | Example IDL |
| [`packages/flux-idl`](./packages/flux-idl) | Parser, codegen, lint, emit |
| [`packages/flux-runtime`](./packages/flux-runtime) | Server & client |
| [`packages/flux-webtransport`](./packages/flux-webtransport) | L3 adapters |
| [`packages/flux-bench`](./packages/flux-bench) | Benchmarks |
| [`examples/users-api`](./examples/users-api) | Demo service |
| [`emit/`](./emit) | Generated OpenAPI / proto / TS |

```bash
npm test
npm run bench
```

---

## Status

**v0.4.0** — zstd auto-compress, shared dictionaries (`dcz`), HTTPS WebTransport demo, plus v0.3 resilience/HTTP3.  
Wire protocol remains language-agnostic. Spec: [docs/SPEC.md](./docs/SPEC.md) · Production: [docs/PRODUCTION.md](./docs/PRODUCTION.md)

---

## License

[MIT](./LICENSE) © 2026 Shivansh Agrawal
