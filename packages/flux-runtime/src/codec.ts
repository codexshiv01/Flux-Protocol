import { createHash } from "node:crypto";
import {
  gunzipSync,
  gzipSync,
  brotliCompressSync,
  brotliDecompressSync,
} from "node:zlib";
import {
  decodeDcb,
  decodeDcz,
  encodeDcb,
  encodeDcz,
  pickContentEncoding,
  zstdAvailable,
  zstdCompress,
  zstdDecompress,
  type FluxDictionary,
  DEFAULT_COMPRESS_THRESHOLD,
} from "./dictionary.js";
import type { FluxRequest, FluxResponse } from "./types.js";

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

/**
 * Real protobuf wire encoding for Flux envelopes.
 *
 * message FluxRequest {
 *   bytes input_json = 1;
 *   bytes select_json = 2;
 *   string op = 3;
 * }
 * message FluxResponse {
 *   bytes data_json = 1;
 *   bytes error_json = 2;
 *   bytes extensions_json = 3;
 * }
 */
export function encodeProto(value: unknown): Uint8Array {
  if (isFluxRequest(value)) return encodeProtoRequest(value);
  if (isFluxResponse(value)) return encodeProtoResponse(value);
  return pbBytes(1, jsonBytes(value));
}

export function encodeProtoRequest(value: FluxRequest): Uint8Array {
  const chunks: Uint8Array[] = [];
  chunks.push(pbBytes(1, jsonBytes(value.input ?? null)));
  if (value.select !== undefined) chunks.push(pbBytes(2, jsonBytes(value.select)));
  if (value.op) chunks.push(pbString(3, value.op));
  return concat(chunks);
}

export function encodeProtoResponse(value: FluxResponse): Uint8Array {
  const chunks: Uint8Array[] = [];
  chunks.push(pbBytes(1, jsonBytes(value.data ?? null)));
  if (value.error != null) chunks.push(pbBytes(2, jsonBytes(value.error)));
  if (value.extensions) chunks.push(pbBytes(3, jsonBytes(value.extensions)));
  return concat(chunks);
}

export function decodeProtoRequest(buf: Uint8Array): FluxRequest {
  const fields = readPbFields(buf);
  return {
    input: fields.has(1) ? JSON.parse(text(fields.get(1)!)) : null,
    select: fields.has(2) ? JSON.parse(text(fields.get(2)!)) : undefined,
    op: fields.has(3) ? text(fields.get(3)!) : undefined,
  };
}

export function decodeProtoResponse(buf: Uint8Array): FluxResponse {
  const fields = readPbFields(buf);
  return {
    data: fields.has(1) ? JSON.parse(text(fields.get(1)!)) : null,
    error: fields.has(2) ? JSON.parse(text(fields.get(2)!)) : null,
    extensions: fields.has(3) ? JSON.parse(text(fields.get(3)!)) : undefined,
  };
}

export function decodeProto(buf: Uint8Array): unknown {
  return decodeProtoRequest(buf);
}

const FLFB = new TextEncoder().encode("FLFB");
const ABSENT = 0xffffffff;

/**
 * FlatBuffers-style L4 layout:
 * magic "FLFB" | version u16 LE | flags u16 LE (1=req 2=res) |
 * 6x u32 offsets | UTF-8 payloads
 */
export function encodeFlatbuffers(value: unknown): Uint8Array {
  const req = isFluxRequest(value) ? value : null;
  const res = !req && isFluxResponse(value) ? value : null;
  const parts: Array<Uint8Array | null> = [
    req ? jsonBytes(req.input ?? null) : null,
    req?.select !== undefined ? jsonBytes(req.select) : null,
    req?.op ? new TextEncoder().encode(req.op) : null,
    res ? jsonBytes(res.data ?? null) : null,
    res?.error != null ? jsonBytes(res.error) : null,
    res?.extensions ? jsonBytes(res.extensions) : null,
  ];

  const headerSize = 4 + 2 + 2 + 6 * 4;
  let payloadSize = 0;
  for (const p of parts) if (p) payloadSize += p.length;
  const out = new Uint8Array(headerSize + payloadSize);
  out.set(FLFB, 0);
  const view = new DataView(out.buffer);
  view.setUint16(4, 1, true);
  view.setUint16(6, req ? 1 : 2, true);
  let cursor = headerSize;
  for (let i = 0; i < 6; i++) {
    const b = parts[i];
    if (!b) {
      view.setUint32(8 + i * 4, ABSENT, true);
    } else {
      view.setUint32(8 + i * 4, cursor, true);
      out.set(b, cursor);
      cursor += b.length;
    }
  }
  return out;
}

export function decodeFlatbuffers(buf: Uint8Array): unknown {
  if (buf.length < 32 || text(buf.subarray(0, 4)) !== "FLFB") {
    throw new Error("invalid flatbuffers magic");
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const flags = view.getUint16(6, true);
  const offs = [0, 1, 2, 3, 4, 5].map((i) => view.getUint32(8 + i * 4, true));
  const sliceAt = (i: number) => {
    const off = offs[i];
    if (off === ABSENT) return null;
    let end = buf.length;
    for (let j = i + 1; j < 6; j++) {
      if (offs[j] !== ABSENT) {
        end = offs[j];
        break;
      }
    }
    return buf.subarray(off, end);
  };
  if (flags === 1) {
    return {
      input: JSON.parse(text(sliceAt(0) ?? jsonBytes(null))),
      select: (() => {
        const b = sliceAt(1);
        return b ? JSON.parse(text(b)) : undefined;
      })(),
      op: (() => {
        const b = sliceAt(2);
        return b ? text(b) : undefined;
      })(),
    };
  }
  return {
    data: JSON.parse(text(sliceAt(3) ?? jsonBytes(null))),
    error: (() => {
      const b = sliceAt(4);
      return b ? JSON.parse(text(b)) : null;
    })(),
    extensions: (() => {
      const b = sliceAt(5);
      return b ? JSON.parse(text(b)) : undefined;
    })(),
  };
}

export function encodeRequest(codec: CodecName, req: FluxRequest): Uint8Array {
  if (codec === "json") return new TextEncoder().encode(JSON.stringify(req));
  if (codec === "flatbuffers") return encodeFlatbuffers(req);
  return encodeProtoRequest(req);
}

export function decodeRequest(codec: CodecName, buf: Uint8Array): FluxRequest {
  if (codec === "json") return JSON.parse(new TextDecoder().decode(buf)) as FluxRequest;
  if (codec === "flatbuffers") return decodeFlatbuffers(buf) as FluxRequest;
  return decodeProtoRequest(buf);
}

export function encodeResponse(codec: CodecName, res: FluxResponse): Uint8Array {
  if (codec === "json") return new TextEncoder().encode(JSON.stringify(res));
  if (codec === "flatbuffers") return encodeFlatbuffers(res);
  return encodeProtoResponse(res);
}

export function decodeResponse(codec: CodecName, buf: Uint8Array): FluxResponse {
  if (codec === "json") return JSON.parse(new TextDecoder().decode(buf)) as FluxResponse;
  if (codec === "flatbuffers") return decodeFlatbuffers(buf) as FluxResponse;
  return decodeProtoResponse(buf);
}

export function etagFor(data: unknown): string {
  const dig = createHash("sha256").update(JSON.stringify(data ?? null)).digest("hex").slice(0, 16);
  return `"flux-${dig}"`;
}

export interface CompressOptions {
  /** Force a specific encoding; `auto` picks from Accept-Encoding. */
  encoding?: string;
  acceptEncoding?: string | string[];
  threshold?: number;
  dictionary?: FluxDictionary;
  /** When client advertised Available-Dictionary matching ours */
  useDictionary?: boolean;
  preferDictionaryEncoding?: "dcz" | "dcb";
}

export function compress(
  encoding: string | undefined,
  data: Uint8Array,
  opts?: CompressOptions,
): { encoding: string; body: Uint8Array } {
  if (opts?.useDictionary && opts.dictionary) {
    const kind = opts.preferDictionaryEncoding ?? "dcz";
    if (kind === "dcz" && zstdAvailable()) {
      return { encoding: "dcz", body: encodeDcz(data, opts.dictionary) };
    }
    return { encoding: "dcb", body: encodeDcb(data, opts.dictionary) };
  }

  let enc = (encoding ?? opts?.encoding ?? "identity").split(",")[0]?.trim().toLowerCase() ?? "identity";
  if (enc === "auto") {
    enc = pickContentEncoding(
      opts?.acceptEncoding,
      data.byteLength,
      opts?.threshold ?? DEFAULT_COMPRESS_THRESHOLD,
    );
  } else if (
    enc !== "identity" &&
    data.byteLength < (opts?.threshold ?? DEFAULT_COMPRESS_THRESHOLD) &&
    encoding === undefined
  ) {
    // Only apply threshold when caller did not force an encoding string via first arg
  }

  // Explicit threshold skip when using auto-selected encodings from pickContentEncoding already handled.
  if (enc === "identity") return { encoding: "identity", body: data };
  if (enc === "gzip") return { encoding: "gzip", body: gzipSync(data) };
  if (enc === "br") return { encoding: "br", body: brotliCompressSync(data) };
  if (enc === "zstd") {
    if (zstdAvailable()) return { encoding: "zstd", body: zstdCompress(data) };
    return { encoding: "gzip", body: gzipSync(data) };
  }
  if (enc === "dcz" && opts?.dictionary && zstdAvailable()) {
    return { encoding: "dcz", body: encodeDcz(data, opts.dictionary) };
  }
  if (enc === "dcb" && opts?.dictionary) {
    return { encoding: "dcb", body: encodeDcb(data, opts.dictionary) };
  }
  return { encoding: "identity", body: data };
}

export function decompress(
  encoding: string | undefined,
  data: Uint8Array,
  dictionary?: FluxDictionary,
): Uint8Array {
  if (!encoding || encoding === "identity" || data.byteLength === 0) return data;
  if (encoding === "gzip") return gunzipSync(data);
  if (encoding === "br") return brotliDecompressSync(data);
  if (encoding === "zstd") {
    if (zstdAvailable()) return zstdDecompress(data);
    return gunzipSync(data);
  }
  if (encoding === "dcz") {
    if (!dictionary) throw new Error("dcz requires dictionary");
    return decodeDcz(data, dictionary);
  }
  if (encoding === "dcb") {
    if (!dictionary) throw new Error("dcb requires dictionary");
    return decodeDcb(data, dictionary);
  }
  return data;
}

export { pickContentEncoding, DEFAULT_COMPRESS_THRESHOLD, zstdAvailable };

function isFluxRequest(v: unknown): v is FluxRequest {
  return !!v && typeof v === "object" && "input" in (v as object) && !("data" in (v as object));
}

function isFluxResponse(v: unknown): v is FluxResponse {
  return !!v && typeof v === "object" && "data" in (v as object);
}

function jsonBytes(v: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(v));
}

function text(buf: Uint8Array): string {
  return new TextDecoder().decode(buf);
}

function pbVarint(n: number): Uint8Array {
  const out: number[] = [];
  let x = n >>> 0;
  while (x >= 0x80) {
    out.push((x & 0x7f) | 0x80);
    x >>>= 7;
  }
  out.push(x);
  return Uint8Array.from(out);
}

function pbKey(field: number, wire: number): Uint8Array {
  return pbVarint((field << 3) | wire);
}

function pbBytes(field: number, data: Uint8Array): Uint8Array {
  return concat([pbKey(field, 2), pbVarint(data.length), data]);
}

function pbString(field: number, s: string): Uint8Array {
  return pbBytes(field, new TextEncoder().encode(s));
}

function readPbFields(buf: Uint8Array): Map<number, Uint8Array> {
  const map = new Map<number, Uint8Array>();
  let o = 0;
  while (o < buf.length) {
    const [key, o1] = readVarint(buf, o);
    o = o1;
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 2) {
      const [len, o2] = readVarint(buf, o);
      o = o2;
      map.set(field, buf.subarray(o, o + len));
      o += len;
    } else if (wire === 0) {
      const [, o2] = readVarint(buf, o);
      o = o2;
    } else if (wire === 5) {
      o += 4;
    } else if (wire === 1) {
      o += 8;
    } else {
      break;
    }
  }
  return map;
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
