# HTTP/3 & network edge for Flux

Terminate **HTTP/3 (QUIC)** at the edge; keep the Flux Node/Go process on HTTP/1.1 or HTTP/2 behind the proxy. Browsers discover H3 via `Alt-Svc`.

## Why

| Feature | Benefit for Flux |
|---|---|
| QUIC streams | Packet loss does not stall unrelated RPCs (no TCP HOL blocking) |
| 0-RTT resume | Returning clients send idempotent GET+APQ on the first flight (~100–300 ms saved on mobile RTT) |
| Connection migration | Wi‑Fi ↔ cellular without dropping WT / long polls |
| Extensible Priorities ([RFC 9218](https://www.rfc-editor.org/rfc/rfc9218.html)) | `Priority: u=1` on interactive reads vs background batch |

## Architecture

```
Browser / mobile
    │  HTTPS :443 (H3 preferred, H2 fallback)
    ▼
Edge (Caddy / nginx / Cloudflare)
    │  Alt-Svc: h3=":443"; ma=86400
    │  Early-Data only for safe GETs
    ▼
Flux runtime :8080 (HTTP/1.1 or h2c)
```

Example configs live in [`deploy/`](../deploy/).

## Caddy (recommended)

```bash
caddy run --config deploy/caddy/Caddyfile
```

Highlights in that file:

- `protocols h1 h2 h3`
- reverse_proxy to `127.0.0.1:8080`
- long timeouts for SSE / streams

## nginx

Use [`deploy/nginx/nginx-http3.conf`](../deploy/nginx/nginx-http3.conf) as a drop-in server block (needs nginx with QUIC, OpenSSL/BoringSSL that supports `ssl_early_data`).

```nginx
listen 443 quic reuseport;
listen 443 ssl;
http2 on;
ssl_early_data on;
add_header Alt-Svc 'h3=":443"; ma=86400';
proxy_set_header Early-Data $ssl_early_data;
```

## 0-RTT / early data rules

QUIC 0-RTT is **replay-sensitive**. Only allow early data for Flux **idempotent GET** (APQ/`@idempotent`).

| Request | Early data |
|---|---|
| `GET /…Service/Get…?op=…` | Allow |
| `POST` mutations | Reject or force 1-RTT (`425 Too Early` if replay suspected) |

At Cloudflare: enable HTTP/3 + 0-RTT; combine with WAF rules that challenge non-GET early data if needed.

Flux client: use `callGet` + `idempotentReadResilience` so retries/hedges stay on the safe path.

## Priority header

```ts
import { FluxClient, idempotentReadResilience } from "@flux/runtime";

const client = new FluxClient({
  baseUrl: "https://api.example.com",
  resilience: {
    ...idempotentReadResilience,
    priority: "u=1", // interactive
  },
});

// Background / batch
await client.callGet("flux.v1.UserService/GetUser", { id }, select, {
  priority: "u=4, i=?1",
  retry: { maxAttempts: 2 },
});
```

Edge proxies that honor RFC 9218 schedule high-urgency RPCs first under congestion.

## WebTransport

WebTransport needs the same UDP/443 path as HTTP/3. After H3 works:

1. Point WT URL at the edge (`https://api.example.com/flux`)
2. Keep SSE fallback (`Accept: text/event-stream`) for restricted networks
3. Use datagrams only for `@datagram` procedures

**Reference terminator:** [`examples/webtransport-demo`](../examples/webtransport-demo) — see [WebTransport guide](./WEBTRANSPORT.md).

## Compression (zstd + dictionaries)

Production servers enable `autoCompress: true` (see `productionOptions`):

- Prefer **zstd** when `Accept-Encoding` advertises it (then br, gzip)
- Skip compression under **512 bytes** by default (`compressThreshold`)
- Optional **RFC 9842-style** shared dictionary via `dictionaryFromSchema(schema)` → `GET /flux/dictionary`, `Content-Encoding: dcz`

```ts
import { FluxServer, productionOptions, dictionaryFromSchema } from "@flux/runtime";

const dictionary = dictionaryFromSchema(schema);
new FluxServer(productionOptions({ schema, dictionary, autoCompress: true }));
```

## Checklist

- [ ] UDP 443 open end-to-end (many corp firewalls still block QUIC → H2 fallback must work)
- [ ] `Alt-Svc` advertised on H2 responses
- [ ] TLS 1.3 certificates valid for browsers (WT requires secure context)
- [ ] Proxy body/time limits ≥ Flux `maxBodyBytes` / stream duration
- [ ] CDN cache only idempotent GET with short `select`/`op` query
- [ ] Client: deadlines + budgeted retries on reads (`idempotentReadResilience`)
- [ ] Clients send `Accept-Encoding: zstd, br, gzip` (FluxClient does)
- [ ] Optional: preload `/flux/dictionary` (`fetchDictionary: true`)

## Related

- [Production](./PRODUCTION.md) — auth, limits, rate limiting  
- [WebTransport](./WEBTRANSPORT.md) — L3 demo  
- [Supportability](./SUPPORTABILITY.md) — curl / CDN / proxy matrix  
- [Benchmarks](./BENCHMARKS.md) — fair / lossy-network methodology  
