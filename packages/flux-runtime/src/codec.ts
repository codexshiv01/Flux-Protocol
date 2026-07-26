import {
  gunzipSync,
  gzipSync,
  brotliCompressSync,
  brotliDecompressSync,
} from "node:zlib";
import { createRequire } from "node:module";
import type { FluxRequest, FluxResponse } from "./types.js";

const require = createRequire(import.meta.url);

export type CodecName = "json" | "proto" | "flatbuffers";

export const CONTENT_TYPES: Record<CodecName, string> = {
  json: "application/flux+json",
  proto: "application/flux+proto",
  flatbuffers: "application/flux+flatbuffers",
};

export function codecFromContentType(ct: string | undefined): CodecName {
  if (!ct) return "json";
  if (ct.includes("flatbuffers")) return "flatbuffers";
  if (ct.includes("proto")) return "proto";
  return "json";
}

export function encodeProto(value: unknown): Uint8Array {
  return encodeValue(value);
}

export function decodeProto(buf: Uint8Array): unknown {
  const { value } = decodeValue(buf, 0);
  return value;
}

export function encodeRequest(codec: CodecName, req: FluxRequest): Uint8Array {
  if (codec === "json") return new TextEncoder().encode(JSON.stringify(req));
  return encodeProto(req);
}

export function decodeRequest(codec: CodecName, buf: Uint8Array): FluxRequest {
  if (codec === "json") {
    return JSON.parse(new TextDecoder().decode(buf)) as FluxRequest;
  }
  return decodeProto(buf) as FluxRequest;
}

export function encodeResponse(codec: CodecName, res: FluxResponse): Uint8Array {
  if (codec === "json") return new TextEncoder().encode(JSON.stringify(res));
  return encodeProto(res);
}

export function decodeResponse(codec: CodecName, buf: Uint8Array): FluxResponse {
  if (codec === "json") {
    return JSON.parse(new TextDecoder().decode(buf)) as FluxResponse;
  }
  return decodeProto(buf) as FluxResponse;
}

function tryZstdCompress(data: Uint8Array): Uint8Array | null {
  try {
    const zlib = require("node:zlib") as {
      zstdCompressSync?: (d: Uint8Array) => Buffer;
    };
    if (zlib.zstdCompressSync) return new Uint8Array(zlib.zstdCompressSync(data));
  } catch {
    /* unavailable */
  }
  return null;
}

function tryZstdDecompress(data: Uint8Array): Uint8Array | null {
  try {
    const zlib = require("node:zlib") as {
      zstdDecompressSync?: (d: Uint8Array) => Buffer;
    };
    if (zlib.zstdDecompressSync) return new Uint8Array(zlib.zstdDecompressSync(data));
  } catch {
    /* unavailable */
  }
  return null;
}

export function compress(
  encoding: string | undefined,
  data: Uint8Array,
): { encoding: string; body: Uint8Array } {
  const enc = (encoding ?? "identity").split(",")[0]?.trim().toLowerCase() ?? "identity";
  if (enc === "gzip") return { encoding: "gzip", body: gzipSync(data) };
  if (enc === "br") return { encoding: "br", body: brotliCompressSync(data) };
  if (enc === "zstd") {
    const z = tryZstdCompress(data);
    if (z) return { encoding: "zstd", body: z };
    return { encoding: "gzip", body: gzipSync(data) };
  }
  return { encoding: "identity", body: data };
}

export function decompress(encoding: string | undefined, data: Uint8Array): Uint8Array {
  if (!encoding || encoding === "identity" || data.byteLength === 0) return data;
  if (encoding === "gzip") return gunzipSync(data);
  if (encoding === "br") return brotliDecompressSync(data);
  if (encoding === "zstd") {
    const z = tryZstdDecompress(data);
    if (z) return z;
    return gunzipSync(data);
  }
  return data;
}

function encodeValue(value: unknown): Uint8Array {
  const chunks: Uint8Array[] = [];
  writeValue(value, chunks);
  return concat(chunks);
}

function writeValue(value: unknown, chunks: Uint8Array[]) {
  if (value === null || value === undefined) {
    chunks.push(Uint8Array.of(0));
    return;
  }
  if (value === false) {
    chunks.push(Uint8Array.of(1));
    return;
  }
  if (value === true) {
    chunks.push(Uint8Array.of(2));
    return;
  }
  if (typeof value === "number") {
    const buf = new Uint8Array(9);
    buf[0] = 3;
    new DataView(buf.buffer).setFloat64(1, value, false);
    chunks.push(buf);
    return;
  }
  if (typeof value === "string") {
    const raw = new TextEncoder().encode(value);
    chunks.push(Uint8Array.of(4));
    chunks.push(varint(raw.length));
    chunks.push(raw);
    return;
  }
  if (value instanceof Uint8Array) {
    chunks.push(Uint8Array.of(5));
    chunks.push(varint(value.length));
    chunks.push(value);
    return;
  }
  if (Array.isArray(value)) {
    chunks.push(Uint8Array.of(6));
    chunks.push(varint(value.length));
    for (const v of value) writeValue(v, chunks);
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    chunks.push(Uint8Array.of(7));
    chunks.push(varint(entries.length));
    for (const [k, v] of entries) {
      const raw = new TextEncoder().encode(k);
      chunks.push(varint(raw.length));
      chunks.push(raw);
      writeValue(v, chunks);
    }
  }
}

function decodeValue(buf: Uint8Array, offset: number): { value: unknown; offset: number } {
  const tag = buf[offset++];
  if (tag === 0) return { value: null, offset };
  if (tag === 1) return { value: false, offset };
  if (tag === 2) return { value: true, offset };
  if (tag === 3) {
    const n = new DataView(buf.buffer, buf.byteOffset + offset, 8).getFloat64(0, false);
    return { value: n, offset: offset + 8 };
  }
  if (tag === 4) {
    const [len, o2] = readVarint(buf, offset);
    const s = new TextDecoder().decode(buf.subarray(o2, o2 + len));
    return { value: s, offset: o2 + len };
  }
  if (tag === 5) {
    const [len, o2] = readVarint(buf, offset);
    return { value: buf.subarray(o2, o2 + len), offset: o2 + len };
  }
  if (tag === 6) {
    const [len, o2] = readVarint(buf, offset);
    offset = o2;
    const arr: unknown[] = [];
    for (let i = 0; i < len; i++) {
      const r = decodeValue(buf, offset);
      arr.push(r.value);
      offset = r.offset;
    }
    return { value: arr, offset };
  }
  if (tag === 7) {
    const [len, o2] = readVarint(buf, offset);
    offset = o2;
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < len; i++) {
      const [klen, o3] = readVarint(buf, offset);
      const key = new TextDecoder().decode(buf.subarray(o3, o3 + klen));
      const r = decodeValue(buf, o3 + klen);
      obj[key] = r.value;
      offset = r.offset;
    }
    return { value: obj, offset };
  }
  throw new Error(`Unknown proto tag ${tag}`);
}

function varint(n: number): Uint8Array {
  const out: number[] = [];
  let x = n >>> 0;
  while (x >= 0x80) {
    out.push((x & 0x7f) | 0x80);
    x >>>= 7;
  }
  out.push(x);
  return Uint8Array.from(out);
}

function readVarint(buf: Uint8Array, offset: number): [number, number] {
  let x = 0;
  let s = 0;
  while (offset < buf.length) {
    const b = buf[offset++];
    x |= (b & 0x7f) << s;
    if ((b & 0x80) === 0) return [x >>> 0, offset];
    s += 7;
  }
  throw new Error("truncated varint");
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
