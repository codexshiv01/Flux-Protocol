# Second-language notes (Go)

Flux L0–L2 are intentionally “boring HTTP”:

1. Implement an `http.Handler` that routes `/{package}.{Service}/{Procedure}`.
2. Decode `application/flux+json` with encoding/json; proto codec matches `@flux/runtime` tagged binary (see SPEC §5 / codec.ts).
3. Never require trailers; put errors in the JSON/binary envelope.
4. Honor GET for `@idempotent` RPCs and set `Cache-Control`.
5. APQ: map SHA-256(canonical select JSON) → selection set.

WebTransport (L3) can be layered via `quic-go` / HTTP/3 later; browsers speak the same length-prefixed envelopes defined in `@flux/webtransport`.
