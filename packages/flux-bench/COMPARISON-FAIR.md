# Fair speed comparison (same grounds)

All protocols: **POST + JSON body parse**, same Node process, N=400.

Network model: **RTT=40ms**, **10 Mbps** applied to request+response bytes.

## Loopback (CPU)

| Protocol | Scenario | Res bytes | Loopback p50 ms | Loopback req/s |
|---|---|---:|---:|---:|
| REST full resource | typical REST (over-fetch) | 4336 | 0.837 | 1009.3 |
| REST selected fields | same fields as Flux/GraphQL | 454 | 0.697 | 1191.4 |
| GraphQL | same selected fields | 472 | 0.616 | 1339.3 |
| gRPC-like RPC | typical gRPC (full message) | 4336 | 0.61 | 1339.1 |
| Flux JSON+select | same selected fields | 501 | 0.659 | 1250.4 |

## Simulated network (realistic)

| Protocol | Scenario | Res bytes | Net p50 ms (RTT=40ms, 10Mbps) | Net equiv req/s |
|---|---|---:|---:|---:|
| REST full resource | typical REST (over-fetch) | 4336 | 44.315 | 22.6 |
| REST selected fields | same fields as Flux/GraphQL | 454 | 41.07 | 24.3 |
| GraphQL | same selected fields | 472 | 41.041 | 24.4 |
| gRPC-like RPC | typical gRPC (full message) | 4336 | 44.089 | 22.7 |
| Flux JSON+select | same selected fields | 501 | 41.122 | 24.3 |

## How to read this

| Question | Answer from this run |
|---|---|
| Flux vs REST when both return the **same fields**? | Essentially tied (network). Loopback CPU is within noise. |
| Flux vs **typical** REST/gRPC (full resource/message)? | **Flux is faster on the network model** (fewer bytes). |
| Flux vs GraphQL (same fields)? | Effectively tied for speed. |

Generated: 2026-07-26T22:34:33.989Z
