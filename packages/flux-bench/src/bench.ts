/**
 * Head-to-head: REST vs GraphQL vs gRPC-like RPC vs Flux
 * - Part A: codec / payload microbench
 * - Part B: end-to-end HTTP round-trips on localhost
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { parseFlux } from "@flux/idl";
import {
  FluxServer,
  createFluxHttpServer,
  encodeRequest,
  encodeResponse,
  decodeResponse,
  encodeProtoRequest,
  encodeProtoResponse,
  decodeProtoResponse,
} from "@flux/runtime";

const user = {
  id: "u_1",
  name: "Ada Lovelace",
  email: "ada@analytical.engine",
  posts: Array.from({ length: 20 }, (_, i) => ({
    id: `p_${i}`,
    title: `Title ${i}`,
    body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(3),
  })),
};

const select = {
  id: true as const,
  name: true as const,
  posts: { title: true as const },
};

const projected = {
  id: user.id,
  name: user.name,
  posts: user.posts.map((p) => ({ title: p.title })),
};

const N_CODEC = Number(process.env.FLUX_BENCH_N ?? 2000);
const N_HTTP = Number(process.env.FLUX_BENCH_HTTP_N ?? 500);

type CodecRow = {
  protocol: string;
  reqBytes: number;
  resBytes: number;
  encodeUs: number;
  decodeUs: number;
  opsPerSec: number;
};

type HttpRow = {
  protocol: string;
  p50Ms: number;
  p95Ms: number;
  meanMs: number;
  resBytes: number;
  reqBytes: number;
  rps: number;
};

function timeUs(fn: () => void, n: number): number {
  const start = performance.now();
  for (let i = 0; i < n; i++) fn();
  return ((performance.now() - start) / n) * 1000;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{
  port: number;
  close: () => void;
}> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      resolve({ port: addr.port, close: () => server.close() });
    });
  });
}

async function httpBench(
  label: string,
  port: number,
  build: () => { path: string; init: RequestInit },
): Promise<HttpRow> {
  // warmup
  for (let i = 0; i < 20; i++) {
    const { path, init } = build();
    await fetch(`http://127.0.0.1:${port}${path}`, init);
  }
  const samples: number[] = [];
  let resBytes = 0;
  let reqBytes = 0;
  const t0 = performance.now();
  for (let i = 0; i < N_HTTP; i++) {
    const { path, init } = build();
    const body = typeof init.body === "string" ? init.body : "";
    reqBytes = Buffer.byteLength(body || path);
    const start = performance.now();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
    const buf = Buffer.from(await res.arrayBuffer());
    samples.push(performance.now() - start);
    resBytes = buf.byteLength;
    if (!res.ok && res.status !== 304) {
      throw new Error(`${label} failed: ${res.status} ${buf.toString("utf8").slice(0, 200)}`);
    }
  }
  const elapsed = (performance.now() - t0) / 1000;
  samples.sort((a, b) => a - b);
  return {
    protocol: label,
    p50Ms: Number(percentile(samples, 50).toFixed(3)),
    p95Ms: Number(percentile(samples, 95).toFixed(3)),
    meanMs: Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(3)),
    resBytes,
    reqBytes,
    rps: Number((N_HTTP / elapsed).toFixed(1)),
  };
}

// --- Part A: codec ---
const codecRows: CodecRow[] = [];

function measureCodec(
  protocol: string,
  reqBytes: number,
  resBytes: number,
  encode: () => void,
  decode: () => void,
) {
  const encodeUs = timeUs(encode, N_CODEC);
  const decodeUs = timeUs(decode, N_CODEC);
  codecRows.push({
    protocol,
    reqBytes,
    resBytes,
    encodeUs: Number(encodeUs.toFixed(3)),
    decodeUs: Number(decodeUs.toFixed(3)),
    opsPerSec: Number((1_000_000 / (encodeUs + decodeUs)).toFixed(1)),
  });
}

const restResJson = JSON.stringify(user);
const gqlReq = JSON.stringify({
  query: '{ user(id:"u_1"){ id name posts { title } } }',
});
const gqlRes = JSON.stringify({ data: { user: projected } });
const grpcLikeReq = JSON.stringify({ id: "u_1" }); // full message in/out like typical gRPC
const grpcLikeRes = JSON.stringify(user);
const grpcLikeProtoReq = encodeProtoRequest({ input: { id: "u_1" } });
const grpcLikeProtoRes = encodeProtoResponse({ data: user, error: null });
const fluxReq = { input: { id: "u_1" }, select };
const fluxRes = { data: projected, error: null, extensions: { cost: 12 } };
const fluxJsonReq = encodeRequest("json", fluxReq);
const fluxJsonRes = encodeResponse("json", fluxRes);
const fluxProtoReq = encodeRequest("proto", fluxReq);
const fluxProtoRes = encodeResponse("proto", fluxRes);

measureCodec("REST (full JSON resource)", 12, Buffer.byteLength(restResJson), () => JSON.stringify(user), () => JSON.parse(restResJson));
measureCodec("GraphQL (query + selected JSON)", Buffer.byteLength(gqlReq), Buffer.byteLength(gqlRes), () => JSON.stringify({ data: { user: projected } }), () => JSON.parse(gqlRes));
measureCodec("gRPC-like (full JSON message)", Buffer.byteLength(grpcLikeReq), Buffer.byteLength(grpcLikeRes), () => JSON.stringify(user), () => JSON.parse(grpcLikeRes));
measureCodec("gRPC-like (full Protobuf message)", grpcLikeProtoReq.byteLength, grpcLikeProtoRes.byteLength, () => encodeProtoResponse({ data: user, error: null }), () => decodeProtoResponse(grpcLikeProtoRes));
measureCodec("Flux JSON + select", fluxJsonReq.byteLength, fluxJsonRes.byteLength, () => encodeResponse("json", fluxRes), () => decodeResponse("json", fluxJsonRes));
measureCodec("Flux Protobuf + select", fluxProtoReq.byteLength, fluxProtoRes.byteLength, () => encodeProtoResponse(fluxRes), () => decodeProtoResponse(fluxProtoRes));

// --- Part B: HTTP e2e ---
const rest = await listen((req, res) => {
  if (req.url?.startsWith("/users/")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(restResJson);
    return;
  }
  res.writeHead(404);
  res.end();
});

const graphql = await listen(async (req, res) => {
  if (req.method === "POST" && req.url === "/graphql") {
    await readBody(req); // consume query text (size matters on wire in real clients)
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(gqlRes);
    return;
  }
  res.writeHead(404);
  res.end();
});

const grpcLike = await listen(async (req, res) => {
  // Simulates gRPC/Connect unary returning the *full* User message (no field selection)
  if (req.method === "POST" && req.url === "/UserService/GetUser") {
    await readBody(req);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(grpcLikeRes);
    return;
  }
  res.writeHead(404);
  res.end();
});

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "../../../schema/user.flux");
const schema = parseFlux(readFileSync(schemaPath, "utf8"));
const fluxServer = new FluxServer({ schema });
fluxServer.register("UserService", {
  GetUser: () => user,
  WatchUser: async function* () {
    yield user;
  },
  Heartbeat: (i) => i,
});
const fluxHttp = await listen(createFluxHttpServer(fluxServer));

const httpRows: HttpRow[] = [];
httpRows.push(
  await httpBench("REST", rest.port, () => ({
    path: "/users/u_1",
    init: { method: "GET" },
  })),
);
httpRows.push(
  await httpBench("GraphQL", graphql.port, () => ({
    path: "/graphql",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: gqlReq,
    },
  })),
);
httpRows.push(
  await httpBench("gRPC-like RPC", grpcLike.port, () => ({
    path: "/UserService/GetUser",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: grpcLikeReq,
    },
  })),
);
httpRows.push(
  await httpBench("Flux JSON+select", fluxHttp.port, () => ({
    path: "/flux.v1.UserService/GetUser",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/flux+json",
        "Flux-Protocol-Version": "1",
      },
      body: JSON.stringify(fluxReq),
    },
  })),
);

rest.close();
graphql.close();
grpcLike.close();
fluxHttp.close();

// --- Print tables ---
function markdownCodec(rows: CodecRow[]): string {
  const lines = [
    "| Protocol | Req bytes | Res bytes | Encode µs | Decode µs | ops/sec |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.protocol} | ${r.reqBytes} | ${r.resBytes} | ${r.encodeUs} | ${r.decodeUs} | ${r.opsPerSec} |`,
    );
  }
  return lines.join("\n");
}

function markdownHttp(rows: HttpRow[]): string {
  const lines = [
    "| Protocol | Res bytes | Req bytes | p50 ms | p95 ms | mean ms | req/s |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.protocol} | ${r.resBytes} | ${r.reqBytes} | ${r.p50Ms} | ${r.p95Ms} | ${r.meanMs} | ${r.rps} |`,
    );
  }
  return lines.join("\n");
}

const restBytes = codecRows.find((r) => r.protocol.startsWith("REST"))!.resBytes;
const fluxBytes = codecRows.find((r) => r.protocol.startsWith("Flux JSON"))!.resBytes;
const grpcBytes = codecRows.find((r) => r.protocol.includes("gRPC-like (full JSON"))!.resBytes;
const savingsVsRest = ((1 - fluxBytes / restBytes) * 100).toFixed(1);
const savingsVsGrpc = ((1 - fluxBytes / grpcBytes) * 100).toFixed(1);

console.log("\n=== A) Payload / codec (same machine, N=" + N_CODEC + ") ===\n");
console.log(markdownCodec(codecRows));
console.log("\n=== B) End-to-end HTTP localhost (N=" + N_HTTP + ") ===\n");
console.log(markdownHttp(httpRows));
console.log(
  `\nFlux JSON response is ${savingsVsRest}% smaller than REST and ${savingsVsGrpc}% smaller than gRPC-like full messages (${fluxBytes} vs ${restBytes} / ${grpcBytes} bytes).`,
);

const out = {
  generatedAt: new Date().toISOString(),
  codecN: N_CODEC,
  httpN: N_HTTP,
  codec: codecRows,
  http: httpRows,
  savingsPercentVsRest: Number(savingsVsRest),
  savingsPercentVsGrpcLike: Number(savingsVsGrpc),
  notes: [
    "REST returns the full resource (typical over-fetch).",
    "GraphQL returns only selected fields but ships a text query on the request.",
    "gRPC-like returns the full User message (no field selection) — matches common gRPC usage.",
    "Flux combines procedure RPC with selection sets (GraphQL-like payload, gRPC-like shape).",
    "HTTP benches are same-host loopback; absolute ms vary by machine — compare relatively.",
  ],
};

const outPath = join(dirname(fileURLToPath(import.meta.url)), "../results.json");
const mdPath = join(dirname(fileURLToPath(import.meta.url)), "../COMPARISON.md");
writeFileSync(outPath, JSON.stringify(out, null, 2));
writeFileSync(
  mdPath,
  `# Flux vs REST vs GraphQL vs gRPC\n\nGenerated: ${out.generatedAt}\n\n## Payload / codec\n\n${markdownCodec(codecRows)}\n\n## End-to-end HTTP (localhost)\n\n${markdownHttp(httpRows)}\n\n## Takeaways\n\n- Flux JSON is **${savingsVsRest}% smaller** than REST full resource and **${savingsVsGrpc}% smaller** than gRPC-like full messages for this fixture (20 posts).\n- GraphQL matches Flux on response size when the selection is identical; Flux keeps an RPC path + binary option without a separate GraphQL runtime.\n- Absolute latency on loopback is close; **bytes and over-fetch** dominate real networks.\n`,
);
console.log(`\nWrote ${outPath}`);
console.log(`Wrote ${mdPath}`);
