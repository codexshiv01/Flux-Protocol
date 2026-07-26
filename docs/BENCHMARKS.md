# Flux Benchmarks

Run:

```bash
npm run bench -w @flux/bench
```

## Latest local results (N=2000)

| Mode | Req bytes | Res bytes | Encode µs | Decode µs | ops/sec |
|---|---|---|---|---|---|
| REST JSON (full) | 12 | 4336 | ~11 | ~10 | ~47k |
| GraphQL-like JSON | 59 | 472 | ~2 | ~5 | ~139k |
| RPC full JSON | 22 | 4358 | ~10 | ~10 | ~48k |
| Flux JSON + select | 78 | 501 | ~4 | ~6 | ~100k |
| Flux Protobuf + select | 52 | 428 | ~58 | ~22 | ~12k |

**Headline:** Flux JSON + selection is **~88% smaller** than full REST JSON for the fixture graph (501 vs 4336 response bytes), beating the plan target of ≥40%.

## Lossy-network / WebTransport methodology

Production bi-di under loss is dominated by **transport**, not JSON vs Protobuf.

Recommended simulation (document results when run):

1. **Baseline:** SSE server-stream Flux WatchUser over HTTP/1.1 or H2; measure completion time and gaps with `tc netem` (Linux) or Clumsy (Windows) at 1–5% loss.
2. **HTTP/3:** Terminate TLS+H3 at a proxy (Caddy/Cloudflare) in front of Flux; repeat.
3. **WebTransport:** Point `@flux/webtransport` client at a WT-capable origin; compare stall time under the same loss profile. Expect WT/QUIC streams to recover per-stream without head-of-line blocking across unrelated streams.

Reference adapters: `packages/flux-webtransport`. Browser demo: `http://localhost:8787/demo`.

## Notes

- Encode/decode µs are CPU microbenchmarks; network RTT dominates in production.
- L1 uses real protobuf wire tags for envelopes; L4 uses distinct `FLFB` flat layout.
- Re-run and refresh `packages/flux-bench/results.json` after changes.
