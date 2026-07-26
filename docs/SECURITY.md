# Security

## Reporting

If you discover a vulnerability in the Flux reference implementation or a protocol ambiguity that enables abuse, please report it privately to the maintainers before public disclosure.

## Protocol hardening (operators)

| Control | Recommendation |
|---|---|
| Selection depth | Cap (default 16 in reference runtime) |
| Selection cost | Cap via `@cost` budgeting (default max 1000) |
| APQ | Prefer allowlisted operations in production |
| Authn / Authz | Authenticate requests; enforce `@auth` and server policies |
| Timeouts | Set server-side maximums even if clients omit `Flux-Timeout-Ms` |
| Batch | Rate-limit `/flux.v1.$batch` |
| TLS | Required in production; mandatory for WebTransport |
| Input size | Limit body bytes at the reverse proxy |

## Trust boundaries

- Treat `select` as untrusted input; always validate against the schema.  
- Do not trust client-supplied roles without authenticating the caller.  
- Generated OpenAPI surfaces may expose a broader partner API — review before publish.
