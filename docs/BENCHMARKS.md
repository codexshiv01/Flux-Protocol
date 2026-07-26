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

Notes:

- Encode/decode µs are CPU microbenchmarks on one machine; network RTT dominates in production.
- Flux Protobuf codec is a compact tagged binary envelope (L1); FlatBuffers L4 remains opt-in via `enableFlatbuffers`.
- Re-run and refresh `packages/flux-bench/results.json` after changes.
