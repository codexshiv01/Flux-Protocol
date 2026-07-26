# Flux Documentation

**Flux** is an application protocol for APIs that need to be *universally reachable* and *efficient by default* — without maintaining separate REST, gRPC, and GraphQL stacks.

| Audience | Start here |
|---|---|
| New to Flux | [Introduction](./introduction.md) |
| Choosing a protocol | [Comparison](./comparison.md) |
| Hands-on in 5 minutes | [Getting Started](./getting-started.md) |
| How Flux works | [Concepts](./concepts.md) |
| Call the API | [Cookbook](./COOKBOOK.md) |
| System design | [Architecture](./architecture.md) |
| Wire format (normative) | [Specification v0.1](./SPEC.md) |
| Deploy & proxies | [Supportability](./SUPPORTABILITY.md) |
| Performance numbers | [Benchmarks](./BENCHMARKS.md) |
| Security | [Security](./SECURITY.md) |
| Production | [Production](./PRODUCTION.md) |
| FAQ | [FAQ](./faq.md) |
| Changelog | [Changelog](./CHANGELOG.md) |
| Roadmap | [Roadmap](./ROADMAP.md) |
| Second language (Go) | [Go notes](./GO.md) |
| Engineering rationale | [Rationale](./RATIONALE.md) |

---

## What you get

- **One schema** (`.flux`) → typed RPC, field selection, OpenAPI, and Protobuf emit  
- **Works with curl and browsers** on day one (plain HTTP, errors in the body)  
- **CDN-friendly reads** via idempotent GET + persisted operations  
- **Binary path** when you need speed; JSON when you need debuggability  
- **Modern streaming** with SSE today and WebTransport for bi-directional browser traffic  

**Status:** v0.2 — production-hardened reference implementation (TypeScript). The wire protocol is language-agnostic.
