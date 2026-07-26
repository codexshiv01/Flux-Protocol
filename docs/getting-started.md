# Getting Started

Get a Flux server answering curl in minutes.

## Requirements

- Node.js **20+**
- npm 10+

## 1. Install

```bash
git clone <your-repo-url> protocol
cd protocol
npm install
npm run build
```

## 2. Run the example API

```bash
npm run example
```

You should see:

```text
Flux users-api listening on http://localhost:8787
```

Verify:

```bash
curl.exe -sS http://localhost:8787/health
```

## 3. Call a procedure (POST + selection)

PowerShell:

```powershell
Set-Content tmp-req.json '{"input":{"id":"u_1"},"select":{"id":true,"name":true,"posts":{"title":true}}}'
curl.exe -sS -X POST "http://localhost:8787/flux.v1.UserService/GetUser" `
  -H "Content-Type: application/flux+json" `
  -H "Flux-Protocol-Version: 1" `
  --data-binary "@tmp-req.json"
```

macOS / Linux:

```bash
curl -sS -X POST "http://localhost:8787/flux.v1.UserService/GetUser" \
  -H "Content-Type: application/flux+json" \
  -H "Flux-Protocol-Version: 1" \
  -d '{"input":{"id":"u_1"},"select":{"id":true,"name":true,"posts":{"title":true}}}'
```

Expected shape:

```json
{
  "data": {
    "id": "u_1",
    "name": "Ada Lovelace",
    "posts": [
      { "title": "Notes on the Analytical Engine" },
      { "title": "Bernoulli numbers" }
    ]
  },
  "error": null,
  "extensions": { "cost": 14 }
}
```

## 4. Try a CDN-friendly GET

`GetUser` is marked `@idempotent` in the schema, so GET is allowed:

```text
http://localhost:8787/flux.v1.UserService/GetUser?encoding=json&message=%7B%22id%22%3A%22u_1%22%7D&select=%7B%22id%22%3Atrue%2C%22name%22%3Atrue%7D
```

Open it in a browser or:

```bash
curl.exe -sSi "http://localhost:8787/flux.v1.UserService/GetUser?encoding=json&message=%7B%22id%22%3A%22u_1%22%7D&select=%7B%22id%22%3Atrue%2C%22name%22%3Atrue%7D"
```

Look for `Cache-Control: public, max-age=60`.

## 5. Understand the schema

Example schema: [`schema/user.flux`](../schema/user.flux)

```flux
package flux.v1;

service UserService {
  rpc GetUser(GetUserInput) -> User
    @idempotent @cache(maxAge: 60)

  rpc WatchUser(WatchUserInput) -> stream User
    @transport(prefer: "webtransport")
}

type User {
  id: ID!
  name: String!
  email: String @auth(role: "admin")
  posts: [Post!]! @cost(10)
}
```

## 6. Generate artifacts

```bash
node packages/flux-idl/dist/cli.js codegen --schema schema/user.flux --out emit/generated
node packages/flux-idl/dist/cli.js emit-openapi --schema schema/user.flux --out emit/openapi.json
node packages/flux-idl/dist/cli.js emit-proto --schema schema/user.flux --out emit/schema.proto
```

## 7. Run tests & benches

```bash
npm test
npm run bench
```

---

## Project map

```text
protocol/
  docs/                 ← you are here
  schema/user.flux      ← example IDL
  packages/
    flux-idl/           ← parser, codegen, lint, emit
    flux-runtime/       ← HTTP server & client
    flux-webtransport/  ← L3 adapters
    flux-bench/         ← comparisons
  examples/users-api/   ← runnable demo
  emit/                 ← generated OpenAPI / proto / TS
```

## Next steps

- [Concepts](./concepts.md) — selection, APQ, errors, streaming  
- [Cookbook](./COOKBOOK.md) — copy-paste calls  
- [Comparison](./comparison.md) — vs REST / gRPC / GraphQL  
- [Specification](./SPEC.md) — normative wire rules  
