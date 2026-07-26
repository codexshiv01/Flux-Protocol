# Flux Protocol

**Typed RPC. Field selection. Plain HTTP.**  
One schema for APIs that need to be reachable everywhere and efficient by default — without maintaining separate REST, gRPC, and GraphQL stacks.

[![CI](https://github.com/codexshiv01/Flux-Protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/codexshiv01/Flux-Protocol/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](./package.json)
[![Version](https://img.shields.io/badge/version-0.4.0-informational)](./docs/CHANGELOG.md)

[Documentation](./docs/README.md) · [Getting started](./docs/getting-started.md) · [Specification](./docs/SPEC.md) · [Benchmarks](./docs/BENCHMARKS.md) · [Comparison](./docs/comparison.md)

---

## Why Flux exists

Teams usually end up with three API styles:

| Surface | Common choice | Cost |
|---|---|---|
| Public / partners | REST + OpenAPI | Over-fetch, schema drift |
| Clients & mobile | GraphQL | Second stack, CDN friction |
| Internal services | gRPC | Browser / edge gaps |

Flux is a single **application protocol**: gRPC-style procedures, GraphQL-style selection, REST-style HTTP reachability — with an optional climb to binary codecs, HTTP/3, and WebTransport.

```
.flux schema
    │
    ├─ curl / fetch / CDN     → JSON, GET + APQ caching
    ├─ apps & services        → selection, protobuf, zstd
    └─ realtime browsers      → WebTransport (SSE fallback)
```

---

## Features

- **One `.flux` schema** → TypeScript types, OpenAPI, and Protobuf emit  
- **Selection sets on every procedure** — ask only for the fields you need  
- **Works with curl on day one** — errors in the response body (no trailers required)  
- **CDN-friendly reads** — idempotent GET + automatic persisted queries (APQ)  
- **Capability ladder** — JSON → binary → WebTransport without changing semantics  
- **Production controls** — auth hook, body limits, rate limits, strict APQ  
- **Client resilience** — deadlines, budgeted retries, request hedging  
- **Compression** — zstd/br/gzip with size thresholds; optional shared dictionaries (`dcz`)

---

## Quick start

**Requirements:** Node.js 20+

```bash
git clone https://github.com/codexshiv01/Flux-Protocol.git
cd Flux-Protocol
npm install
npm run build
npm run example
```

Health check:

```bash
curl -sS http://localhost:8787/health
```

Unary call with field selection:

```bash
curl -sS -X POST http://localhost:8787/flux.v1.UserService/GetUser \
  -H "Content-Type: application/flux+json" \
  -H "Flux-Protocol-Version: 1" \
  -d '{"input":{"id":"u_1"},"select":{"id":true,"name":true,"posts":{"title":true}}}'
```

Browser demo: [http://localhost:8787/demo](http://localhost:8787/demo)

```bash
npm test              # unit tests
npm run bench:fair    # fair REST / GraphQL / gRPC-like / Flux comparison
npm run example:wt    # HTTPS + WebTransport demo (see examples/webtransport-demo)
```

---

## Capability ladder

| Tier | Transport | Codec | Role |
|:----:|---|---|---|
| **L0** | HTTP/1.1 | JSON | Universal default — required for conformance |
| **L1** | HTTP/2–3 | Protobuf + compression | Production speed path |
| **L2** | HTTP GET + APQ | JSON or binary | Edge / CDN cached reads |
| **L3** | WebTransport | Binary / JSON + datagrams | Browser bi-di & realtime |
| **L4** | HTTP/3 | FlatBuffers (optional) | Internal hot paths |

Conformance requires **L0**. Everything else is additive.

---

## Example schema

```flux
package flux.v1;

type User {
  id: ID!
  name: String!
  email: String @auth(role: "admin")
  posts: [Post!]! @cost(10)
}

service UserService {
  rpc GetUser(GetUserInput) -> User
    @idempotent @cache(maxAge: 60)

  rpc WatchUser(WatchUserInput) -> stream User
}
```

Client (TypeScript):

```ts
import { FluxClient, idempotentReadResilience } from "@flux/runtime";

const client = new FluxClient({
  baseUrl: "http://localhost:8787",
  resilience: idempotentReadResilience,
});

const res = await client.call(
  "flux.v1.UserService/GetUser",
  { id: "u_1" },
  { id: true, name: true, posts: { title: true } },
);
```

---

## Performance (honest)

Fair bench: same machine, POST+JSON, N=400. Network model: **40 ms RTT**, **10 Mbps**.

| Scenario | Result |
|---|---|
| Same selected fields (Flux vs GraphQL vs REST-selected) | Effectively **tied** on the network model |
| Flux vs typical REST/gRPC **over-fetch** | Flux ~**1.08×** lower latency; response ~**88% smaller** (501 vs 4336 bytes) |

Loopback CPU races are not the product goal. Flux wins when payloads shrink and the path stays cacheable. Full methodology: [`docs/BENCHMARKS.md`](./docs/BENCHMARKS.md).

---

## Repository layout

| Path | Description |
|---|---|
| [`docs/`](./docs/README.md) | Product docs, spec, production & security guides |
| [`schema/`](./schema/user.flux) | Example IDL |
| [`packages/flux-idl`](./packages/flux-idl) | Parser, lint, codegen, OpenAPI / Protobuf emit |
| [`packages/flux-runtime`](./packages/flux-runtime) | HTTP server & client, selection, APQ, compression |
| [`packages/flux-webtransport`](./packages/flux-webtransport) | L3 session helpers + SSE fallback |
| [`packages/flux-bench`](./packages/flux-bench) | Comparative benchmarks |
| [`examples/users-api`](./examples/users-api) | Reference service + browser demo |
| [`examples/webtransport-demo`](./examples/webtransport-demo) | HTTPS / HTTP/3 WebTransport terminator |
| [`deploy/`](./deploy) | Caddy & nginx HTTP/3 edge recipes |
| [`go/fluxserver`](./go/fluxserver) | Go unary JSON reference |

---

## Documentation

| Guide | Link |
|---|---|
| Introduction | [docs/introduction.md](./docs/introduction.md) |
| Getting started | [docs/getting-started.md](./docs/getting-started.md) |
| Cookbook | [docs/COOKBOOK.md](./docs/COOKBOOK.md) |
| Production | [docs/PRODUCTION.md](./docs/PRODUCTION.md) |
| HTTP/3 & edge | [docs/HTTP3.md](./docs/HTTP3.md) |
| WebTransport | [docs/WEBTRANSPORT.md](./docs/WEBTRANSPORT.md) |
| Security | [docs/SECURITY.md](./docs/SECURITY.md) |
| Wire specification | [docs/SPEC.md](./docs/SPEC.md) |
| Roadmap | [docs/ROADMAP.md](./docs/ROADMAP.md) |

---

## Status

**v0.4** — production-hardened TypeScript reference (auth, limits, resilience, compression dictionaries, WebTransport demo).

| Ready for | Not yet |
|---|---|
| Open-source preview / internal APIs with real auth & TLS | Formal security audit / regulated 1.0 claim |
| Fair performance comparisons & edge HTTP/3 termination | Full Go parity (proto + streams) |
| npm workspace development | Published `@flux/*` packages on npm |

The **wire protocol** is language-agnostic; TypeScript is the reference implementation.

---

## Contributing

1. `npm install && npm run build && npm test`  
2. Keep L0 (HTTP + JSON) working for every feature  
3. Prefer measured claims — update benches when changing codecs or framing  

Issues and PRs welcome: [github.com/codexshiv01/Flux-Protocol](https://github.com/codexshiv01/Flux-Protocol)

---

## License

[MIT](./LICENSE) © 2026 Shivansh Agrawal
