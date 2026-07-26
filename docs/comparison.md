# Flux vs REST, gRPC, GraphQL, Connect, and tRPC

This page is the decision guide for architects evaluating Flux for production.

---

## Executive summary

| If you need… | Prefer |
|---|---|
| Maximum public reach, human docs, partner integrations | REST (+ OpenAPI) *or* Flux L0 JSON |
| Client-driven fields across many UIs | GraphQL *or* Flux selection sets |
| Polyglot internal RPC + streaming | gRPC *or* Flux L1 binary |
| gRPC semantics that still work with curl/CDNs | ConnectRPC *or* Flux |
| TypeScript-only monorepo DX | tRPC |
| **One contract for reach + selection + binary + modern browser streams** | **Flux** |

Flux’s differentiator is the **combination**: Connect-grade HTTP friendliness **plus** GraphQL-grade selection/APQ/CDN reads **plus** a first-class WebTransport path — from one schema.

---

## Scorecard (2026)

Ratings are relative (●●●●● = excellent for that dimension).

| Dimension | REST | GraphQL | gRPC | Connect | tRPC | **Flux** |
|---|---|---|---|---|---|---|
| curl / browser without plugins | ●●●●● | ●●●●○ | ●○○○○ | ●●●●● | ●●●○○ | ●●●●● |
| CDN cacheability (reads) | ●●●●● | ●●○○○¹ | ●○○○○ | ●●●●○ | ●●○○○ | ●●●●● |
| Avoid over-fetch | ●○○○○ | ●●●●● | ●○○○○ | ●○○○○ | ●●○○○ | ●●●●● |
| Binary efficiency | ●○○○○ | ●○○○○ | ●●●●● | ●●●●● | ●●○○○ | ●●●●○ |
| Streaming (server) | ●●○○○ | ●●●○○ | ●●●●● | ●●●●○ | ●●●○○ | ●●●●○ |
| Browser bi-di (modern) | ●●○○○ | ●●○○○ | ●○○○○² | ●●○○○ | ●●○○○ | ●●●●○³ |
| Polyglot codegen | ●●●●○ | ●●●○○ | ●●●●● | ●●●●● | ●○○○○ | ●●●○○⁴ |
| Single schema for all surfaces | ●●○○○ | ●●●○○ | ●●●○○ | ●●●○○ | ●●○○○ | ●●●●● |
| Proxy / CDN trailer safety | ●●●●● | ●●●●● | ●○○○○ | ●●●●● | ●●●●○ | ●●●●● |

¹ GraphQL is usually POST; GET+APQ helps but is optional and uneven.  
² Native gRPC in browsers historically needs gRPC-Web or a proxy.  
³ WebTransport Baseline (2026) + SSE fallback in the reference impl.  
⁴ TS reference today; OpenAPI/Protobuf emit + Go notes for polyglot path.

---

## Deep comparison

### REST + OpenAPI

**Strengths:** Universal literacy, caching, status codes, enormous tooling.  
**Weaknesses:** Over/under-fetch; ad-hoc “query params as field filters”; weak standardized bi-di streaming.  
**Flux relationship:** Flux L0 looks and feels like a disciplined HTTP API. OpenAPI is **generated** from `.flux` for partners who only speak REST resources.

**Choose REST alone when:** your API is stable CRUD and clients are fine downloading full resources.

---

### GraphQL

**Strengths:** Exact client data shapes; great for multi-client products; rich ecosystem (persisted queries, federation).  
**Weaknesses:** Text-heavy queries on the uplink; resolver complexity / N+1; streaming and CDN story are secondary; often a second stack beside REST/gRPC.  
**Flux relationship:** Flux adopts **selection sets**, **APQ**, **partial errors**, and **cost/depth limits** — without requiring a separate GraphQL runtime for every service.

**Choose GraphQL alone when:** you already run a mature GraphQL platform (federation, persisted query allowlists, Observability) and do not want another contract.

---

### gRPC

**Strengths:** Compact Protobuf, deadlines, rich streaming, excellent polyglot codegen.  
**Weaknesses:** HTTP/2 + trailers hurt browsers and some CDNs/Workers; no native field selection → over-fetch or many RPCs; operational friction at the edge.  
**Flux relationship:** Flux keeps **procedures, schemas, streams, deadlines, binary payloads** — drops trailer dependence and adds selection.

**Choose gRPC alone when:** traffic is almost entirely service-to-service inside a controlled mesh, and edge/browser is someone else’s problem (a gateway).

---

### ConnectRPC

**Strengths:** Best “gRPC that works with curl and browsers”; JSON + Protobuf; no trailers; GET for idempotent RPCs; Envoy ecosystem.  
**Weaknesses:** Still **RPC-shaped** — clients receive full response messages unless you invent field masks yourself; no built-in query/APQ/CDN selection model.  
**Flux relationship:** Closest sibling. Flux deliberately copies Connect’s supportability lessons, then adds **selection + APQ + CDN-oriented reads + WebTransport app mapping**.

**Choose Connect when:** you want Protobuf RPC over HTTP and do not need GraphQL-like field selection as a protocol feature.

---

### tRPC

**Strengths:** Best-in-class TypeScript DX; inference without codegen in monorepos.  
**Weaknesses:** Not a polyglot wire protocol; external/mobile/partner clients need another surface.  
**Flux relationship:** Complementary. Use tRPC inside a TS app; use Flux when the **same API** must leave the monorepo.

---

## Side-by-side request shapes

**REST** — resource, full entity:

```http
GET /users/u_1
```

**gRPC** — procedure, full message:

```text
UserService.GetUser(GetUserRequest) returns (User)
```

**GraphQL** — query language, selected fields:

```graphql
query { user(id: "u_1") { id name posts { title } } }
```

**Flux** — procedure + selection, plain HTTP:

```http
POST /flux.v1.UserService/GetUser
Content-Type: application/flux+json

{ "input": { "id": "u_1" }, "select": { "id": true, "name": true, "posts": { "title": true } } }
```

---

## Performance narrative (honest)

End-to-end latency is usually dominated by **network RTT and bytes on the wire**, not microseconds of codec choice.

Flux optimizes the levers that move production metrics:

1. **Selection sets** — do not serialize fields the client never asked for  
2. **APQ** — replace large selection documents with a hash on the uplink  
3. **GET + Cache-Control** — let CDNs absorb repeated reads  
4. **Binary + zstd/br/gzip** — shrink hot paths without abandoning JSON  
5. **HTTP/3 / WebTransport** — reduce head-of-line pain for multiplexed streams  

Reference benches (fixture with 20 posts): Flux JSON + select was **~88% smaller** than returning the full REST JSON entity. See [BENCHMARKS.md](./BENCHMARKS.md).

---

## Migration postures

| From | Suggested path |
|---|---|
| REST | Keep URLs for partners via OpenAPI emit; move first-party clients to Flux procedures + select |
| GraphQL BFF | Map popular operations to Flux procedures; keep GraphQL temporarily as a façade if needed |
| gRPC mesh | Emit `.proto` from `.flux`; put Flux or Connect at the edge; keep interior gRPC until ready |
| Connect | Add selection gradually; Flux can sit beside Connect during evaluation |

---

## Bottom line

- **REST** wins pure reach.  
- **GraphQL** wins pure client-shaped data.  
- **gRPC** wins pure interior binary RPC.  
- **Connect** wins gRPC-over-HTTP supportability.  
- **Flux** wins when you refuse to run three of the above forever.

Next: [Getting Started →](./getting-started.md)
