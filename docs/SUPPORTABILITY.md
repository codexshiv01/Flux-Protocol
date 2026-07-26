# Flux Supportability Guide

## Non-negotiable rules

1. Plain HTTP unary semantics (POST/GET + meaningful status codes).
2. No trailer dependency — errors always in the response body.
3. Unary works on HTTP/1.1; H2/H3 accelerate, they do not gate correctness.
4. JSON content type works with stock `curl` and browser `fetch`.
5. Idempotent procedures support GET + `Cache-Control` / `ETag`.
6. Proxy-friendly paths: `/package.Service/Procedure`.
7. Content negotiation: `application/flux+json`, `application/flux+proto`, `application/flux+flatbuffers`.
8. OpenAPI emission for partners who only speak REST.

## CDN / proxy matrix

| Infrastructure | Unary JSON | Unary Protobuf | Server stream (SSE) | WebTransport | Notes |
|---|---|---|---|---|---|
| curl / fetch | Yes | Yes | Yes | N/A (curl) | Primary smoke test |
| nginx | Yes | Yes | Yes | Needs H3 module | No special Flux filter |
| Cloudflare | Yes | Yes | Verify plan | Edge-dependent | Prefer GET+APQ for cache |
| Fastly / CloudFront | Yes | Yes | Verify | Limited | Cache GET only |
| Envoy | Yes | Yes | Yes | Experimental | Treat as HTTP |
| Cloudflare Workers | Yes | Yes | Limited | Limited | Avoid trailers (Flux never needs them) |

## curl cookbook

### Unary JSON POST

```bash
curl -sS -X POST "http://localhost:8787/flux.v1.UserService/GetUser" \
  -H "Content-Type: application/flux+json" \
  -H "Flux-Protocol-Version: 1" \
  -d '{"input":{"id":"u_1"},"select":{"id":true,"name":true,"posts":{"title":true}}}'
```

### Idempotent GET (CDN-friendly)

```bash
curl -sS "http://localhost:8787/flux.v1.UserService/GetUser?encoding=json&message=%7B%22id%22%3A%22u_1%22%7D&select=%7B%22id%22%3Atrue%2C%22name%22%3Atrue%7D"
```

### Persisted operation (APQ)

```bash
# First call may return PERSISTED_OP_NOT_FOUND — retry with full select once.
curl -sS -X POST "http://localhost:8787/flux.v1.UserService/GetUser" \
  -H "Content-Type: application/flux+json" \
  -H "Flux-Protocol-Version: 1" \
  -d '{"input":{"id":"u_1"},"op":"<sha256>","select":{"id":true,"name":true}}'
```

### With timeout

```bash
curl -sS -X POST "http://localhost:8787/flux.v1.UserService/GetUser" \
  -H "Content-Type: application/flux+json" \
  -H "Flux-Protocol-Version: 1" \
  -H "Flux-Timeout-Ms: 5000" \
  -d '{"input":{"id":"u_1"},"select":{"id":true,"name":true}}'
```

## Deploy notes

### nginx

```nginx
location / {
  proxy_pass http://flux_upstream;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_buffering off; # for SSE streams
}
```

### Cloudflare

- Cache GET requests with `op=` or short `message=` query params.
- Do not rely on HTTP trailers (Flux does not).
- For WebTransport, terminate at origin or a capable edge product.

### Envoy

Treat Flux L0–L2 as ordinary HTTP. No Connect-gRPC bridge required for Flux-native traffic.
