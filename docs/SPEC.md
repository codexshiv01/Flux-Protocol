# Flux Protocol Specification v0.1

**Status:** Draft  
**Version:** 1 (`Flux-Protocol-Version: 1`)

> Looking for a product overview? Start at [Documentation Home](./README.md), [Introduction](./introduction.md), and [Comparison](./comparison.md).  
> This document is **normative** wire and IDL behavior for implementers.

## 1. Design goals

1. One semantic model for procedures + selectable response graphs.
2. Unary calls work on HTTP/1.1 with JSON and stock HTTP tools.
3. Binary Protobuf + compression for production speed.
4. Idempotent GET + persisted operations for CDN caching.
5. Streaming mapped per transport; WebTransport for bi-di and datagrams.
6. Errors always appear in the response body (trailers never required).

## 2. Capability ladder

| Tier | Transport | Codec | Required for conformance |
|---|---|---|---|
| L0 | HTTP/1.1 | JSON | **Yes** |
| L1 | HTTP/2 or HTTP/3 | Protobuf | Recommended |
| L2 | HTTP + GET + APQ | JSON or Protobuf | Recommended |
| L3 | WebTransport | Protobuf/JSON | Optional |
| L4 | HTTP/3 | FlatBuffers | Optional |

## 3. Paths

```
Procedure-Path = "/" Package "." Service "/" Procedure
```

Example: `/flux.v1.UserService/GetUser`

Optional routing prefix: `/api/flux.v1.UserService/GetUser`

## 4. Headers

| Header | Direction | Meaning |
|---|---|---|
| `Flux-Protocol-Version` | req | Must be `1` |
| `Content-Type` | req/res | See content types |
| `Flux-Timeout-Ms` | req | Deadline in milliseconds |
| `Content-Encoding` | either | `identity` \| `gzip` \| `br` \| `zstd` |
| `Accept-Encoding` | req | Ordered preference list |
| `Cache-Control` | res | For idempotent GET responses |
| `ETag` | res | Optional entity tag |
| `traceparent` / `tracestate` | either | W3C / OpenTelemetry |

Keys beginning with `flux-` are reserved.

## 5. Content types

| Type | Payload |
|---|---|
| `application/flux+json` | UTF-8 JSON envelope |
| `application/flux+proto` | Protobuf-encoded envelope |
| `application/flux+flatbuffers` | FlatBuffers envelope (L4) |
| `application/flux-stream+json` | Length-prefixed JSON stream frames |
| `application/flux-stream+proto` | Length-prefixed Protobuf stream frames |
| `text/event-stream` | SSE server-stream fallback |

## 6. Unary request envelope (JSON)

```json
{
  "input": { },
  "select": { "field": true, "nested": { "a": true } },
  "op": "optional_sha256_hex_of_canonical_select"
}
```

- `input` — procedure input object (required unless empty message).
- `select` — selection set; omit or `true` means “all scalar fields at this level” is **not** allowed for nested graphs — clients should be explicit. Servers MAY default to all non-costly scalars if `select` is omitted (implementation-defined; reference impl defaults to all declared fields without `@cost` > 0 nested collections).
- `op` — SHA-256 hex of canonical JSON selection (APQ).

### Unary GET (idempotent only)

```
GET {path}?encoding=json|proto
    &message={url-encoded input JSON}
    &select={url-encoded select JSON}
    &op={sha256}
    &base64=1   (optional: message/select are base64url)
```

Servers MUST reject GET for procedures not marked `@idempotent`.

## 7. Unary response envelope (JSON)

```json
{
  "data": { },
  "error": null,
  "extensions": {
    "cost": 0,
    "cache": { "ttl": 60 }
  }
}
```

### Error object

```json
{
  "code": "not_found",
  "message": "user not found",
  "details": [],
  "path": ["posts", 0, "author"]
}
```

`error` may be a single object or an array for partial field failures. When partial errors occur, `data` MAY still contain successfully resolved fields.

### Error codes

`canceled` | `unknown` | `invalid_argument` | `deadline_exceeded` | `not_found` | `already_exists` | `permission_denied` | `resource_exhausted` | `failed_precondition` | `aborted` | `out_of_range` | `unimplemented` | `internal` | `unavailable` | `data_loss` | `unauthenticated` | `persisted_op_not_found`

### HTTP status mapping (unary)

| Condition | Status |
|---|---|
| Success | 200 |
| `persisted_op_not_found` | 404 or 200 with error body (ref impl: 200 + error code) |
| `invalid_argument` | 400 |
| `unauthenticated` | 401 |
| `permission_denied` | 403 |
| `not_found` | 404 |
| `deadline_exceeded` | 408 |
| `resource_exhausted` | 429 |
| `unimplemented` | 501 |
| `unavailable` | 503 |
| Other | 500 |

Streaming responses always use HTTP 200; terminal errors appear in the final stream frame body.

## 8. Selection sets

A selection set is a JSON object:

```
Selection = { FieldName: true | Selection }
```

Rules:

1. Unknown fields → `invalid_argument`.
2. Requesting a field the caller is not authorized for → omit or `permission_denied` at path (schema `@auth`).
3. Max depth default: 16.
4. Field `@cost(n)` accumulates; servers SHOULD reject when total cost exceeds configured max (default 1000).

Canonical form for APQ hashing: UTF-8 JSON with sorted object keys, no insignificant whitespace.

## 9. Automatic persisted operations (APQ)

1. Client sends `op` (+ optionally `select`).
2. If server unknown and `select` present: store mapping, execute.
3. If server unknown and `select` absent: return `persisted_op_not_found`.
4. If known: use stored selection.

## 10. Batch envelope

```json
{
  "batch": [
    { "id": "1", "procedure": "flux.v1.UserService/GetUser", "input": {}, "select": {} },
    { "id": "2", "procedure": "flux.v1.UserService/GetUser", "input": {}, "select": {}, "op": "..." }
  ]
}
```

POST to `/flux.v1.$batch`. Response: `{ "results": [ { "id", "data", "error", "extensions" } ] }`.

## 11. Streaming

### Frame (binary length-prefixed)

```
Flags (1 byte) | Length (4 bytes BE) | Payload
```

Flags: `0x00` message, `0x01` end/error trailer-equivalent body, `0x02` compress payload.

### SSE fallback

`Content-Type: text/event-stream`  
Each event `data:` is a JSON unary-response-shaped object; final event may include `"error"`.

### WebTransport mapping (L3)

- Each RPC call = one bidirectional stream.
- First message: request envelope.
- Subsequent messages: stream payloads.
- Datagram channel: procedures annotated `@datagram` only; payload = request envelope without streaming.
- Path indicated in WT URL query: `?procedure=flux.v1.UserService/WatchUser`.

## 12. IDL grammar (`.flux`)

```
File       = PackageDecl Definition*
PackageDecl = "package" Ident ";"
Definition = Service | Type | Input
Service    = "service" Ident "{" Rpc* "}"
Rpc        = "rpc" Ident "(" Ident ")" "->" ["stream"] Ident Directive*
Type       = "type" Ident "{" Field* "}"
Input      = "input" Ident "{" Field* "}"
Field      = Ident ":" TypeRef ["!"] Directive*
TypeRef    = Ident | "[" TypeRef ["!"] "]"
Directive  = "@" Ident ["(" Args ")"]
```

Built-in scalars: `String`, `Int`, `Float`, `Boolean`, `ID`, `Bytes`.

Standard directives:

- `@idempotent` — allows GET
- `@cache(maxAge: Int)` — suggests Cache-Control max-age
- `@cost(Int)` — selection cost
- `@auth(role: String)` — authorization hint
- `@transport(prefer: String)` — e.g. `"webtransport"`
- `@datagram` — unreliable datagram eligible

## 13. Compression

Supported: `identity`, `gzip`, `br`, `zstd`.  
Zero-length bodies MUST NOT be decompressed.

## 14. Security

- Validate selection against schema.
- Enforce depth and cost limits.
- Apply `@auth` before resolving fields.
- Prefer allowlisted persisted ops in production (strict APQ mode).

## 15. Conformance checklist (v0.1)

- [ ] Unary JSON POST
- [ ] Unary JSON GET for `@idempotent`
- [ ] Selection validation
- [ ] Errors in body
- [ ] APQ register + hit
- [ ] Cache-Control on cached GET
- [ ] Protobuf unary (L1)
- [ ] SSE server stream
- [ ] WebTransport bi-di (optional)
