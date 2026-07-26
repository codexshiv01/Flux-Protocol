# FAQ

## Is Flux a replacement for HTTP?

No. Flux is an **application protocol** on top of HTTP (and optionally WebTransport). It uses normal methods, status codes, and content types.

## Is Flux “faster than gRPC”?

Not as a blanket claim. gRPC’s binary path is excellent inside a controlled mesh. Flux aims to be the **fastest practical choice that remains supportable at the edge**, by cutting bytes (selection, APQ, compression) and offering HTTP/3 / WebTransport where available. Always check [BENCHMARKS.md](./BENCHMARKS.md) for your payloads.

## How is Flux different from ConnectRPC?

Connect makes gRPC-shaped RPC work over plain HTTP with JSON/Protobuf and no trailers. Flux adds **protocol-native field selection**, **APQ**, **CDN-oriented GET caching**, and a **WebTransport application mapping** — so you are not forced into a second GraphQL layer for flexible clients.

## How is Flux different from GraphQL?

GraphQL is a query language and execution model. Flux is procedure-oriented (RPC) with GraphQL-like **selection** on responses. You keep clear mutations/actions and streaming RPCs, while still asking for only the fields you need.

## Do I need HTTP/3 or WebTransport to use Flux?

No. **L0 (HTTP/1.1 + JSON)** is required and sufficient for unary calls. Higher tiers are optional accelerators.

## Will my CDN / nginx / Cloudflare setup work?

Unary JSON/Protobuf over normal HTTP should. Flux does **not** require trailers. Idempotent GETs are designed for cache hierarchies. See [SUPPORTABILITY.md](./SUPPORTABILITY.md).

## Can I use Flux from the browser?

Yes — `fetch` for unary and SSE for server streams. WebTransport adapters are provided for modern Baseline browsers.

## Why is the reference implementation in TypeScript?

To ship browser + server demos quickly and prove curl/`fetch` supportability. The wire format is language-agnostic; Go is the planned second implementation ([GO.md](./GO.md)).

## Can partners who only know REST still integrate?

Yes. Generate OpenAPI from `.flux` and expose a documented JSON surface. First-party apps can use full Flux selection + binary.

## Is the spec stable?

**v0.1** is a draft suitable for evaluation and early adoption. Expect additive evolution; use schema lint / breaking-change checks before production freezes.

## Where do I start?

1. [Introduction](./introduction.md)  
2. [Getting Started](./getting-started.md)  
3. [Comparison](./comparison.md)  
