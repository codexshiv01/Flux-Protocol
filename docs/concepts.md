# Concepts

Core ideas behind Flux, without the full normative grammar (see [SPEC.md](./SPEC.md) for that).

---

## 1. Procedures, not only resources

Flux APIs are organized like gRPC:

```text
/{package}.{Service}/{Procedure}
```

Example: `/flux.v1.UserService/GetUser`

Procedures take an **input** message and return an **output** type (optionally streamed). This keeps actions (`WatchUser`, `Heartbeat`) first-class — something pure resource REST often contorts.

---

## 2. Selection sets

Every unary (and stream message) can include a **select** object:

```json
{
  "input": { "id": "u_1" },
  "select": {
    "id": true,
    "name": true,
    "posts": { "title": true }
  }
}
```

Rules of thumb:

- Only requested fields are returned  
- Unknown fields → `invalid_argument`  
- Nested objects use nested objects in `select`  
- Field `@cost` accumulates; over-budget → `resource_exhausted`  
- `@auth` can omit or error a field by role  

This is GraphQL’s primary product benefit — without shipping a separate GraphQL server for every backend.

---

## 3. Envelopes

**Request**

```json
{ "input": {}, "select": {}, "op": "optional_sha256" }
```

**Response**

```json
{ "data": {}, "error": null, "extensions": { "cost": 0 } }
```

Errors always live in `error` (object or array for partial failures). **HTTP trailers are never required.**

---

## 4. Content types

| Content-Type | Use |
|---|---|
| `application/flux+json` | Default human / browser / curl path |
| `application/flux+proto` | Compact binary envelope (L1) |
| `application/flux+flatbuffers` | Optional turbo (L4), feature-flagged |
| `text/event-stream` | Server-stream fallback (SSE) |
| `application/flux-stream+*` | Length-prefixed stream frames |

Negotiate with normal `Content-Type` / `Accept` habits. Compression: `gzip`, `br`, `zstd`.

---

## 5. Idempotent GET & caching

Procedures annotated `@idempotent` may be invoked with HTTP GET. Combined with `@cache(maxAge: N)`, servers emit `Cache-Control` so CDNs and browsers can cache reads.

This fixes a chronic GraphQL pain (POST-only queries) without abandoning a typed procedure model.

---

## 6. Automatic persisted operations (APQ)

Large selection documents hurt mobile uplinks. Flux supports APQ:

1. Client sends `op=<sha256(canonical select)>`  
2. If unknown and `select` present → server stores mapping and executes  
3. If unknown and no `select` → `persisted_op_not_found` (retry once with full select)  
4. Later calls send only the hash (and input) — ideal for GET + CDN  

Production tip: prefer **allowlisted** persisted ops (strict mode) for public APIs.

---

## 7. Streaming

| Mode | Flux approach |
|---|---|
| Server stream | Framed HTTP body or SSE (`?format=sse`) |
| Client / bi-di | HTTP/2+ or WebTransport bi-di streams |
| Unreliable telemetry | WebTransport datagrams + `@datagram` |

Always provide a degradation path: browsers without WebTransport can still use SSE for server streams.

---

## 8. Schema directives (v0.1)

| Directive | Meaning |
|---|---|
| `@idempotent` | Allows GET |
| `@cache(maxAge: N)` | Suggests Cache-Control |
| `@cost(N)` | Selection budgeting |
| `@auth(role: "…")` | Field authorization hint |
| `@transport(prefer: "webtransport")` | Preferred transport |
| `@datagram` | Eligible for unreliable datagrams |

---

## 9. Batching

POST `/flux.v1.$batch` with:

```json
{
  "batch": [
    {
      "id": "1",
      "procedure": "flux.v1.UserService/GetUser",
      "input": { "id": "u_1" },
      "select": { "id": true, "name": true }
    }
  ]
}
```

One RTT, multiple procedures — useful for mobile and BFF consolidation.

---

## 10. Observability

Propagate W3C `traceparent` / `tracestate`. Response `extensions.cost` aids abuse detection and capacity planning.

---

Next: [Architecture →](./architecture.md) · [Cookbook →](./COOKBOOK.md)
