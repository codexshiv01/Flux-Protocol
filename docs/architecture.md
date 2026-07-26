# Architecture

How the Flux reference stack fits together.

---

## System view

```text
┌─────────────────────────────────────────────────────────────┐
│                         Clients                             │
│  curl · browser fetch · mobile · services · WebTransport    │
└───────────────────────────┬─────────────────────────────────┘
                            │  HTTP/1.1 · H2 · H3 · WT
┌───────────────────────────▼─────────────────────────────────┐
│                    Edge / proxies                           │
│         nginx · Cloudflare · Fastly · Envoy                 │
│     (see “boring HTTP” — no trailer requirement)            │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                   @flux/runtime                             │
│  route → APQ → auth/cost → handler → project(select) → codec│
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
        application logic              @flux/webtransport
        (your handlers)                (L3 session adapters)
└─────────────────────────────────────────────────────────────┘
```

---

## Packages

| Package | Responsibility |
|---|---|
| `@flux/idl` | Parse `.flux`, lint, breaking-change check, TS codegen, OpenAPI & Protobuf emit |
| `@flux/runtime` | HTTP server/client, selection engine, APQ store, codecs, batch, SSE/frames |
| `@flux/webtransport` | Browser WT client, stream pump, datagram helper, SSE fallback URLs |
| `@flux/bench` | Comparative microbenchmarks |
| `@flux/users-api` | Reference service demonstrating the full loop |

---

## Request lifecycle (unary)

1. Match `/{package}.{Service}/{Procedure}`  
2. Read body (or GET query), honor `Content-Encoding`  
3. Decode JSON or binary envelope  
4. Resolve selection (`select` and/or APQ `op`)  
5. Invoke handler with deadline (`Flux-Timeout-Ms`)  
6. Validate & project result through the selection engine  
7. Attach `extensions` (cost, cache hints)  
8. Encode, optional compress, write status + body (errors in body)

---

## Schema → artifacts

```text
user.flux
   │
   ├─► TypeScript types & handler interfaces
   ├─► openapi.json          (partner REST-ish surface)
   └─► schema.proto          (interop / migration aid)
```

One source of truth reduces drift between “the GraphQL schema,” “the proto,” and “the OpenAPI file.”

---

## Deployment patterns

### Pattern A — Single Flux origin

All first-party clients speak Flux. Partners use generated OpenAPI or JSON Flux L0.

### Pattern B — Edge Flux, interior gRPC

Terminate Flux (or Connect) at the edge; keep existing gRPC mesh inland. Emit protos from `.flux` to stay aligned.

### Pattern C — Strangler

1. Publish `.flux` next to existing REST/GraphQL  
2. Move one high-traffic read to Flux GET+APQ  
3. Measure CDN hit ratio and payload size  
4. Expand procedure coverage; retire duplicate endpoints  

---

## Security checklist

- [ ] Enforce selection depth & cost limits  
- [ ] Prefer allowlisted APQ in production  
- [ ] Apply `@auth` (and real authn) before resolving sensitive fields  
- [ ] Set sane `Flux-Timeout-Ms` defaults server-side  
- [ ] Rate-limit `$batch`  
- [ ] TLS everywhere; WebTransport requires HTTPS  

---

## Language roadmap

| Runtime | Role |
|---|---|
| TypeScript (now) | Reference implementation, browsers, demos |
| Go (next) | Polyglot services, Envoy-native handlers — see [GO.md](./GO.md) |
| Others | Any language that can speak HTTP + the envelope codecs |

The **protocol** is not TypeScript. TS is how we prove supportability quickly.
