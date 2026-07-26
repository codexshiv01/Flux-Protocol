# Flux Protocol — Rationale

> Product-facing overview: start with [Introduction](./introduction.md) and [Comparison](./comparison.md).  
> This document retains the engineering rationale and research freeze behind v0.1.

## Problem


Teams today run hybrid stacks: REST for public APIs, gRPC for internal mesh, GraphQL for flexible clients. That means three schemas, three toolchains, and three failure modes.

Flux is one semantic model — procedures + selectable types — carried over a **capability ladder** so the same API is curl-friendly at the edge and binary-fast between services.

## Comparison matrix

| System | Supportability | Speed | Modern (2026) | Gap Flux fills |
|---|---|---|---|---|
| REST + OpenAPI | Best | Mediocre | Mature | No selection, weak streaming |
| gRPC | Weak at edge | Excellent | Aging (H2-centric) | Trailers, no field select, browser pain |
| GraphQL | Good (HTTP) | Weak encode + N+1 risk | Strong for BFFs | Text-heavy, weak bi-di |
| ConnectRPC | Excellent | Excellent binary | Strong | RPC-only; no selection/APQ/CDN-query model |
| tRPC | TS-only | Good | Excellent DX | Not polyglot wire |
| BXP / Cap’n+QUIC | Poor | Extreme | Niche | No curl/CDN/browser story |
| WebTransport | Baseline Mar 2026 | Excellent | Newest | Transport only — needs an app protocol |

## What kills protocols in production

| Failure mode | Who suffers | Flux rule |
|---|---|---|
| HTTP/2-only + trailers | gRPC through CDNs/Workers | Never require trailers; errors in body |
| Browser can’t speak wire | Native gRPC | Every unary call works via `fetch` / `curl` |
| POST-only queries | GraphQL / many RPCs | GET + Cache-Control for idempotent ops |
| Huge query strings uplink | GraphQL | Persisted operations (APQ) |
| Over-fetch | REST/gRPC | Selection sets on every response type |
| TCP head-of-line blocking | H1 / H2-on-TCP | Prefer HTTP/3; WebTransport for bi-di |
| Codec without ecosystem | Cap’n Proto / custom | Default Protobuf; optional turbo later |
| Three APIs to maintain | Hybrid stacks | One `.flux` schema → all surfaces |

## Capability ladder

| Tier | Transport | Codec | Role |
|---|---|---|---|
| L0 Universal | HTTP/1.1 | JSON | Max support (curl, legacy) |
| L1 Default | HTTP/2 or HTTP/3 | Protobuf + zstd | Production default |
| L2 Edge | HTTP/3 + GET + APQ | Protobuf | CDN-cached reads |
| L3 Modern | WebTransport | Protobuf (+ datagrams) | Bi-di + unreliable |
| L4 Turbo | HTTP/3 / QUIC | FlatBuffers (optional) | Internal mesh CPU wins |

Same procedure and selection semantics on every tier.

## What Flux keeps and drops

| Source | Keep | Drop |
|---|---|---|
| HTTP | Methods, status, caching, proxies, curl | Resource-only as the only model |
| gRPC | IDL, codegen, streams, deadlines, binary | Trailer-mandatory, H2-only, no selection |
| GraphQL | Selection sets, APQ, partial errors, cost limits | Text QL as only wire; federation in v1 |
| ConnectRPC | No trailers, JSON+proto, GET idempotent | Missing query/selection/CDN-op model |
| WebTransport | Multiplexed bi-di, datagrams, QUIC | Not an app protocol by itself |

## Serialization choice

- **Protobuf** — default: compact, evolution, deep tooling.
- **JSON** — mandatory interop/debug path.
- **FlatBuffers** — optional L4 turbo when decode CPU dominates.
- **zstd / br / gzip** — first-class `Content-Encoding`.

Bytes and RTTs dominate end-to-end latency more than codec microseconds. Selection sets + APQ + HTTP/3 are the primary speed levers.

## Positioning

Connect owns “gRPC over plain HTTP.” Flux differentiates on **selection + APQ/CDN + WebTransport as a first-class application path** on one schema — that combination does not exist as one open protocol today.

Claims of “fastest” are gated on `packages/flux-bench` measurements, not slogans.
