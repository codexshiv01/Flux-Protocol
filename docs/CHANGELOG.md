# Changelog

All notable changes to the Flux protocol and reference implementation.

## [0.1.0] — 2026-07-27

### Added

- Protocol specification v0.1 (`Flux-Protocol-Version: 1`)
- Capability ladder L0–L4 (JSON, binary, GET+APQ, WebTransport, optional FlatBuffers)
- `@flux/idl` — parser, lint, breaking-change detection, TypeScript codegen, OpenAPI & Protobuf emit
- `@flux/runtime` — HTTP server/client, selection engine, APQ, batch, SSE & framed streams, compression
- `@flux/webtransport` — browser WT client helpers, session pump, SSE fallback
- `@flux/bench` — REST / GraphQL-like / RPC / Flux comparisons
- Example service `@flux/users-api` on port 8787
- Product documentation suite under `docs/`

### Notes

- v0.1 is intended for evaluation and early integration. Wire details may evolve additively before 1.0.
