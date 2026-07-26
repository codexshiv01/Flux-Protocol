# Cookbook

Copy-paste recipes for the reference server at `http://localhost:8787`.

Start it with `npm run example`. Full deploy notes: [SUPPORTABILITY.md](./SUPPORTABILITY.md).

---

## Health

```bash
curl.exe -sS http://localhost:8787/health
```

---

## Unary POST with field selection

```powershell
Set-Content tmp-req.json '{"input":{"id":"u_1"},"select":{"id":true,"name":true,"posts":{"title":true}}}'
curl.exe -sS -X POST "http://localhost:8787/flux.v1.UserService/GetUser" `
  -H "Content-Type: application/flux+json" `
  -H "Flux-Protocol-Version: 1" `
  --data-binary "@tmp-req.json"
```

```bash
curl -sS -X POST "http://localhost:8787/flux.v1.UserService/GetUser" \
  -H "Content-Type: application/flux+json" \
  -H "Flux-Protocol-Version: 1" \
  -d '{"input":{"id":"u_1"},"select":{"id":true,"name":true,"posts":{"title":true}}}'
```

---

## Idempotent GET (CDN-friendly)

```bash
curl.exe -sSi "http://localhost:8787/flux.v1.UserService/GetUser?encoding=json&message=%7B%22id%22%3A%22u_1%22%7D&select=%7B%22id%22%3Atrue%2C%22name%22%3Atrue%7D"
```

Expect `Cache-Control: public, max-age=60`.

Browser: paste the same URL into the address bar.

---

## Request a protected field

`email` requires role `admin`:

```powershell
Set-Content tmp-req.json '{"input":{"id":"u_1"},"select":{"id":true,"email":true}}'
curl.exe -sS -X POST "http://localhost:8787/flux.v1.UserService/GetUser" `
  -H "Content-Type: application/flux+json" `
  -H "Flux-Protocol-Version: 1" `
  -H "Flux-Roles: admin" `
  --data-binary "@tmp-req.json"
```

Without `Flux-Roles: admin`, expect a path error for `email` (or omission, depending on policy).

---

## Deadline

```powershell
curl.exe -sS -X POST "http://localhost:8787/flux.v1.UserService/GetUser" `
  -H "Content-Type: application/flux+json" `
  -H "Flux-Protocol-Version: 1" `
  -H "Flux-Timeout-Ms: 5000" `
  --data-binary "@tmp-req.json"
```

---

## Server-Sent Events (WatchUser)

```bash
curl.exe -sSN "http://localhost:8787/flux.v1.UserService/WatchUser?format=sse&message=%7B%22id%22%3A%22u_1%22%7D&select=%7B%22id%22%3Atrue%2C%22name%22%3Atrue%7D"
```

---

## Batch

```powershell
Set-Content tmp-batch.json '{"batch":[{"id":"1","procedure":"flux.v1.UserService/GetUser","input":{"id":"u_1"},"select":{"id":true,"name":true}}]}'
curl.exe -sS -X POST "http://localhost:8787/flux.v1.`$batch" `
  -H "Content-Type: application/flux+json" `
  -H "Flux-Protocol-Version: 1" `
  --data-binary "@tmp-batch.json"
```

---

## Binary codec (proto envelope)

Use a Flux client with `codec: "proto"`, or send `Content-Type: application/flux+proto` with a body produced by `@flux/runtime`’s encoder. JSON remains the debug path.

---

## TypeScript client snippet

```ts
import { FluxClient } from "@flux/runtime";

const client = new FluxClient({ baseUrl: "http://localhost:8787" });

const res = await client.call(
  "flux.v1.UserService/GetUser",
  { id: "u_1" },
  { id: true, name: true, posts: { title: true } },
);

console.log(res.data);
```

---

## Persist a selection (APQ)

1. Call once with both `select` and `op` (sha256 of canonical select).  
2. On later calls, send only `op` + `input`.  
3. If the server returns `persisted_op_not_found`, retry once with full `select`.

Helpers: `hashSelection` from `@flux/runtime`.
