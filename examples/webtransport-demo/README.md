# Flux WebTransport demo (L3)

Real **HTTPS + HTTP/3 WebTransport** terminator for Flux unary/stream envelopes, with SSE/HTTP fallback on the same box.

## Quick start

```bash
# from repo root
npm install
npm run certs -w @flux/webtransport-demo
npm start -w @flux/webtransport-demo
```

Open [https://localhost:4433/](https://localhost:4433/) and trust the short-lived self-signed cert.

### Optional native QUIC stack

For actual `WebTransport` sessions (UDP/HTTP3), install separately (not required for HTTPS Flux demo):

```bash
npm i @fails-components/webtransport @fails-components/webtransport-transport-http3-quiche -w @flux/webtransport-demo
npm start -w @flux/webtransport-demo
```

Without those packages the demo still serves Flux over HTTPS (TCP) and exposes `/flux/dictionary`.

## What it shows

| Path | Role |
|---|---|
| `https://localhost:4433/` | Browser UI (WT button + SSE link) |
| `https://localhost:4433/flux.v1.UserService/GetUser` | Normal Flux HTTP |
| `https://localhost:4433/flux/dictionary` | RFC 9842-style shared dictionary |
| `https://localhost:4433/flux` (UDP/H3) | WebTransport sessions → Flux envelopes |

## Cert notes

WebTransport **rejects** plain “click through” trust for self-signed certs.

Requirements:

1. **ECDSA** certificate (P-256), not RSA  
2. Validity **≤ 14 days**  
3. Browser must pass `serverCertificateHashes` (the demo page does this automatically)

```bash
npm run certs -w @flux/webtransport-demo -- --force
```

## Related

- [HTTP/3 edge guide](../../docs/HTTP3.md)
- `@flux/webtransport` — `acceptFluxWebTransportSession`, `sseFallbackUrl`
