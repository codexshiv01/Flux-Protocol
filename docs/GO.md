# Second language: Go

Flux L0–L2 are intentionally “boring HTTP.” This tree ships a **wire-compatible Go unary server**.

## Run

```bash
cd go/fluxserver
go run .
# listens on :8788 (override with PORT)
```

## Verify against the same envelope as TypeScript

```bash
curl.exe -sS -X POST "http://localhost:8788/flux.v1.UserService/GetUser" ^
  -H "Content-Type: application/flux+json" ^
  -H "Flux-Protocol-Version: 1" ^
  -H "traceparent: 00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01" ^
  --data-binary "@-" 
```

Or GET:

```text
http://localhost:8788/flux.v1.UserService/GetUser?encoding=json&message=%7B%22id%22%3A%22u_1%22%7D&select=%7B%22id%22%3Atrue%2C%22name%22%3Atrue%7D
```

## Compatibility checklist

| Feature | Go server |
|---|---|
| `application/flux+json` unary POST | Yes |
| Idempotent GET + Cache-Control | Yes |
| Selection projection | Yes (basic) |
| ETag / If-None-Match | Yes |
| `traceparent` echo | Yes |
| Protobuf / FlatBuffers / streams | Not in this minimal binary (use TS runtime) |

Implementers: decode envelopes per [SPEC.md](./SPEC.md); never require trailers.
