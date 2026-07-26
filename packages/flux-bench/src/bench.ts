import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeRequest,
  encodeResponse,
  decodeResponse,
  encodeProto,
  decodeProto,
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

function project(value: typeof user, sel: typeof select) {
  return {
    id: value.id,
    name: value.name,
    posts: value.posts.map((p) => ({ title: p.title })),
  };
}

function time(fn: () => void, n: number): number {
  const start = performance.now();
  for (let i = 0; i < n; i++) fn();
  return (performance.now() - start) / n;
}

const N = Number(process.env.FLUX_BENCH_N ?? 2000);
const projected = project(user, select);

const restFullReq = JSON.stringify({ id: "u_1" });
const restFullRes = JSON.stringify(user);
const graphqlLikeReq = JSON.stringify({
  query: "{ user(id:\"u_1\"){ id name posts { title } } }",
});
const graphqlLikeRes = JSON.stringify({ data: { user: projected } });
const rpcFullReq = JSON.stringify({ input: { id: "u_1" } });
const rpcFullRes = JSON.stringify({ data: user, error: null });
const fluxReqObj = { input: { id: "u_1" }, select };
const fluxResObj = { data: projected, error: null, extensions: { cost: 12 } };

type Row = {
  mode: string;
  reqBytes: number;
  resBytes: number;
  encodeUs: number;
  decodeUs: number;
  opsPerSec: number;
};

const rows: Row[] = [];

function measure(
  mode: string,
  reqBytes: number,
  resBytes: number,
  encode: () => void,
  decode: () => void,
) {
  const encodeUs = time(encode, N) * 1000;
  const decodeUs = time(decode, N) * 1000;
  const opsPerSec = 1_000_000 / (encodeUs + decodeUs);
  rows.push({
    mode,
    reqBytes,
    resBytes,
    encodeUs: Number(encodeUs.toFixed(3)),
    decodeUs: Number(decodeUs.toFixed(3)),
    opsPerSec: Number(opsPerSec.toFixed(1)),
  });
}

measure(
  "REST JSON (full)",
  restFullReq.length,
  restFullRes.length,
  () => JSON.stringify(user),
  () => JSON.parse(restFullRes),
);

measure(
  "GraphQL-like JSON",
  graphqlLikeReq.length,
  graphqlLikeRes.length,
  () => JSON.stringify({ data: { user: projected } }),
  () => JSON.parse(graphqlLikeRes),
);

measure(
  "RPC full JSON",
  rpcFullReq.length,
  rpcFullRes.length,
  () => JSON.stringify({ data: user, error: null }),
  () => JSON.parse(rpcFullRes),
);

const fluxJsonReq = encodeRequest("json", fluxReqObj);
const fluxJsonRes = encodeResponse("json", fluxResObj);
measure(
  "Flux JSON + select",
  fluxJsonReq.byteLength,
  fluxJsonRes.byteLength,
  () => encodeResponse("json", fluxResObj),
  () => decodeResponse("json", fluxJsonRes),
);

const fluxProtoReq = encodeRequest("proto", fluxReqObj);
const fluxProtoRes = encodeResponse("proto", fluxResObj);
measure(
  "Flux Protobuf + select",
  fluxProtoReq.byteLength,
  fluxProtoRes.byteLength,
  () => encodeProto(fluxResObj),
  () => decodeProto(fluxProtoRes),
);

console.log(`Flux bench (N=${N})`);
console.table(rows);

const restRes = rows.find((r) => r.mode.startsWith("REST"))!;
const fluxJson = rows.find((r) => r.mode.startsWith("Flux JSON"))!;
const savings = (1 - fluxJson.resBytes / restRes.resBytes) * 100;
console.log(
  `\nFlux JSON response is ${savings.toFixed(1)}% smaller than full REST JSON (${fluxJson.resBytes} vs ${restRes.resBytes} bytes)`,
);

const out = join(dirname(fileURLToPath(import.meta.url)), "../results.json");
writeFileSync(out, JSON.stringify({ n: N, rows, savingsPercent: savings }, null, 2));
console.log(`Wrote ${out}`);
