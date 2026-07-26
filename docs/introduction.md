# Introduction to Flux

## The problem

Modern products rarely use one API style:

| Surface | Typical choice | Why |
|---|---|---|
| Public / partner APIs | REST + OpenAPI | Universal tooling, docs, caches |
| Mobile & multi-client UIs | GraphQL | Clients ask for exactly the fields they need |
| Internal microservices | gRPC | Compact binary, streaming, strong schemas |
| TypeScript monorepos | tRPC | End-to-end types with minimal ceremony |

That split is rational — and expensive. Teams maintain **three schemas**, **three clients**, and **three operational failure modes** (trailers at the CDN, over-fetch on mobile, GraphQL N+1, browser proxies for gRPC, and so on).

**Flux exists so you do not have to choose between reach and efficiency.**

---

## What Flux is

Flux is an **application protocol**: a single semantic model for *procedures* (like gRPC) whose responses are *selectable graphs* (like GraphQL), carried over **plain HTTP** (like REST/Connect) with an optional upgrade path to **HTTP/3 and WebTransport**.

```
One .flux schema
        │
        ├─► curl / fetch / CDN   (JSON, GET caching)
        ├─► Mobile & web apps    (selection sets, APQ)
        ├─► Service mesh         (binary codec, streams)
        └─► Realtime browsers    (WebTransport / SSE)
```

Flux is **not** a replacement for TCP, QUIC, or HTTP. It sits *above* HTTP the way gRPC and GraphQL do — with deliberate compatibility so reverse proxies see “boring HTTP” for the common path.

---

## Design principles

1. **Supportability first for the default path**  
   If `curl` and `fetch` cannot call it, it is not Flux’s default.

2. **Speed by negotiation, not by exclusivity**  
   Peers climb a capability ladder (JSON → binary → WebTransport). Same procedure, same selection rules.

3. **One schema, many surfaces**  
   OpenAPI and Protobuf are *emitted*, not hand-maintained forks.

4. **Errors in the body**  
   Never require HTTP trailers. CDNs and Workers strip them; Flux does not depend on them.

5. **Measure before marketing**  
   Payload and CPU claims are gated on published benches (`npm run bench`).

---

## Capability ladder

| Tier | Name | Transport | Codec | Who it’s for |
|---|---|---|---|---|
| **L0** | Universal | HTTP/1.1 | JSON | curl, legacy proxies, debugging |
| **L1** | Default | HTTP/2 or HTTP/3 | Binary (`flux+proto`) + compression | Production apps & services |
| **L2** | Edge | HTTP + GET + APQ | JSON or binary | CDN-cached reads |
| **L3** | Modern | WebTransport | Binary / JSON + datagrams | Browser bi-di & realtime |
| **L4** | Turbo | HTTP/3 / QUIC | FlatBuffers (optional) | Internal hot paths |

Conformance requires **L0**. Everything else is additive.

---

## A first request

```http
POST /flux.v1.UserService/GetUser HTTP/1.1
Host: api.example.com
Content-Type: application/flux+json
Flux-Protocol-Version: 1

{
  "input": { "id": "u_1" },
  "select": {
    "id": true,
    "name": true,
    "posts": { "title": true }
  }
}
```

```json
{
  "data": {
    "id": "u_1",
    "name": "Ada Lovelace",
    "posts": [
      { "title": "Notes on the Analytical Engine" }
    ]
  },
  "error": null,
  "extensions": { "cost": 14 }
}
```

You get **RPC clarity** (`UserService/GetUser`) and **GraphQL-style field selection** in one round trip — over infrastructure that already understands HTTP.

---

## Who Flux is for

**Good fit**

- Products that today run REST *and* GraphQL *and/or* gRPC  
- Public APIs that must stay curl-friendly but want typed clients and lean payloads  
- Teams targeting browsers + mobile + services from one contract  
- Edge/CDN-heavy read traffic that still wants a typed procedure model  

**Poor fit (today)**

- Pure TypeScript monorepos happy with tRPC and no external consumers  
- Ultra-specialized zero-copy meshes where Cap’n Proto/raw QUIC already win and browsers do not matter  
- Organizations that only need a static OpenAPI CRUD surface with no selection or streaming  

---

## Status

| Item | State |
|---|---|
| Spec | v0.1 (draft, normative intent) |
| Reference runtime | TypeScript / Node |
| Browser unary | Yes (`fetch`) |
| Streaming | SSE + framed HTTP streams; WebTransport adapters |
| Second language | Go notes published; full Go runtime planned |

Next: [Comparison with other protocols →](./comparison.md)
