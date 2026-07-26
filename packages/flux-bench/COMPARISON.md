# Flux vs REST vs GraphQL vs gRPC

Generated: 2026-07-26T22:34:36.971Z

## Payload / codec

| Protocol | Req bytes | Res bytes | Encode µs | Decode µs | ops/sec |
|---|---:|---:|---:|---:|---:|
| REST (full JSON resource) | 12 | 4336 | 10.898 | 10.063 | 47706.6 |
| GraphQL (query + selected JSON) | 59 | 472 | 2.917 | 6.047 | 111553 |
| gRPC-like (full JSON message) | 12 | 4336 | 10.523 | 10.929 | 46614.5 |
| gRPC-like (full Protobuf message) | 14 | 4339 | 24.086 | 14.768 | 25737.8 |
| Flux JSON + select | 78 | 501 | 3.303 | 6.844 | 98552.8 |
| Flux Protobuf + select | 62 | 470 | 7.382 | 7.024 | 69412.1 |

## End-to-end HTTP (localhost)

| Protocol | Res bytes | Req bytes | p50 ms | p95 ms | mean ms | req/s |
|---|---:|---:|---:|---:|---:|---:|
| REST | 4336 | 10 | 0.6 | 1.3 | 0.716 | 1388.1 |
| GraphQL | 472 | 59 | 0.784 | 1.937 | 0.977 | 1019.6 |
| gRPC-like RPC | 4336 | 12 | 0.662 | 1.224 | 0.775 | 1283.1 |
| Flux JSON+select | 501 | 78 | 0.684 | 1.317 | 0.812 | 1221.2 |

## Takeaways

- Flux JSON is **88.4% smaller** than REST full resource and **88.4% smaller** than gRPC-like full messages for this fixture (20 posts).
- GraphQL matches Flux on response size when the selection is identical; Flux keeps an RPC path + binary option without a separate GraphQL runtime.
- Absolute latency on loopback is close; **bytes and over-fetch** dominate real networks.
