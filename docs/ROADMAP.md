# Flux Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| 0 | RATIONALE + SUPPORTABILITY | Done |
| 1 | SPEC v0.1 | Done |
| 2 | L0/L1 runtime MVP (JSON + Protobuf unary, GET, APQ) | Done |
| 3 | Speed pack (zstd/gzip/br, batch, benches) | Done |
| 4 | WebTransport L3 + SSE fallback | Done (adapters + SSE) |
| 5 | FlatBuffers L4 (optional flag) | Scaffolded (`enableFlatbuffers`) |
| 6 | Ecosystem (OpenAPI emit, lint, Go notes, cookbook) | Done |

## Near-term

1. Harden selection typing in codegen for partial selects.
2. Full Go wire-compatible server (see `docs/GO.md`).
3. Lossy-network WebTransport vs H2 comparison.
