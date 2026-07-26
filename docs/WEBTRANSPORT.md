# WebTransport (Flux L3)

Flux maps bi-directional RPCs and `@datagram` procedures onto **WebTransport** when available, with **SSE** as the universal fallback.

## Status

WebTransport is Web Platform Baseline (all major browsers as of 2026). Node does not yet ship a production-ready built-in terminator — use:

1. **Edge** (Caddy / nginx / Cloudflare) terminating H3, or  
2. The reference demo: [`examples/webtransport-demo`](../examples/webtransport-demo) using `@fails-components/webtransport`

## Run the demo

```bash
npm run certs -w @flux/webtransport-demo
npm start -w @flux/webtransport-demo
# optional native stack:
npm i @fails-components/webtransport @fails-components/webtransport-transport-http3-quiche -w @flux/webtransport-demo
```

## Wire format on WT streams

1. Client opens a bidirectional stream  
2. Length-prefixed JSON header: `{ "procedure": "pkg.Service/Method" }`  
3. Length-prefixed Flux request envelope (`application/flux+json` or proto bytes)  
4. Server replies with length-prefixed Flux response envelope(s); streams may send many

Datagrams: same header+body framing for loss-tolerant `@datagram` RPCs.

## Server bridge

```ts
import { acceptFluxWebTransportSession } from "@flux/webtransport";

void acceptFluxWebTransportSession(wtSession, {
  async handleUnary(procedure, request) { /* … */ return { data, error: null }; },
  async *handleStream(procedure, request) { yield { data, error: null }; },
});
```

## Fallback

```ts
import { sseFallbackUrl } from "@flux/webtransport";
const url = sseFallbackUrl("https://api.example.com/", "flux.v1.UserService/WatchUser", { id: "u_1" });
```

## Related

- [HTTP/3 & Alt-Svc](./HTTP3.md)  
- [Architecture](./architecture.md)  
