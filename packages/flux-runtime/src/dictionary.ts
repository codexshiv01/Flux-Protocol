import { createHash } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { createRequire } from "node:module";
import type { FluxSchema } from "@flux/idl";

const require = createRequire(import.meta.url);

/** Skip compression below this size (CPU not worth it on tiny JSON). */
export const DEFAULT_COMPRESS_THRESHOLD = 512;

export type ContentEncoding = "identity" | "gzip" | "br" | "zstd" | "dcz" | "dcb";

/**
 * Prefer zstd → br → gzip from Accept-Encoding when body is large enough.
 * Returns identity for tiny payloads.
 */
export function pickContentEncoding(
  acceptEncoding: string | string[] | undefined,
  bodyBytes: number,
  threshold: number = DEFAULT_COMPRESS_THRESHOLD,
): ContentEncoding {
  if (bodyBytes < threshold) return "identity";
  const raw = Array.isArray(acceptEncoding) ? acceptEncoding.join(",") : (acceptEncoding ?? "");
  const tokens = raw
    .toLowerCase()
    .split(",")
    .map((t) => t.trim().split(";")[0]!.trim())
    .filter(Boolean);
  if (!tokens.length) {
    // No Accept-Encoding → leave uncompressed (curl / simple clients).
    return "identity";
  }
  if (tokens.length === 1 && tokens[0] === "identity") return "identity";
  if (tokens.includes("zstd") && zstdAvailable()) return "zstd";
  if (tokens.includes("br")) return "br";
  if (tokens.includes("gzip") || tokens.includes("deflate")) return "gzip";
  if (tokens.includes("*")) return zstdAvailable() ? "zstd" : "gzip";
  return "identity";
}

export function zstdAvailable(): boolean {
  try {
    const zlib = require("node:zlib") as { zstdCompressSync?: unknown };
    return typeof zlib.zstdCompressSync === "function";
  } catch {
    return false;
  }
}

export function zstdCompress(data: Uint8Array, dictionary?: Uint8Array): Uint8Array {
  const zlib = require("node:zlib") as {
    zstdCompressSync: (d: Uint8Array, o?: { dictionary?: Uint8Array }) => Buffer;
  };
  return new Uint8Array(
    dictionary ? zlib.zstdCompressSync(data, { dictionary }) : zlib.zstdCompressSync(data),
  );
}

export function zstdDecompress(data: Uint8Array, dictionary?: Uint8Array): Uint8Array {
  const zlib = require("node:zlib") as {
    zstdDecompressSync: (d: Uint8Array, o?: { dictionary?: Uint8Array }) => Buffer;
  };
  return new Uint8Array(
    dictionary ? zlib.zstdDecompressSync(data, { dictionary }) : zlib.zstdDecompressSync(data),
  );
}

/** RFC 9842-style magic for dictionary-compressed Zstandard (`dcz`). */
const DCZ_MAGIC = Uint8Array.of(0xff, 0x2f, 0x32, 0x2a);

/** RFC 9842-style magic for dictionary-compressed Brotli (`dcb`). */
const DCB_MAGIC = Uint8Array.of(0xff, 0x44, 0x43, 0x42);

export interface FluxDictionary {
  /** Short id for Dictionary-ID header */
  id: string;
  /** Raw dictionary bytes */
  bytes: Uint8Array;
  /** SHA-256 of dictionary bytes (hex) */
  sha256: string;
  /** Optional URL match pattern for Use-As-Dictionary */
  match?: string;
}

export function hashDictionary(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Build a compression dictionary from representative JSON samples
 * (e.g. APQ response shapes / schema field names).
 */
export function buildDictionaryFromSamples(
  samples: string[],
  opts?: { id?: string; match?: string },
): FluxDictionary {
  const joined = samples.filter(Boolean).join("\n");
  // Pad small corpora so zstd dictionaries stay useful.
  const seed =
    joined.length >= 256
      ? joined
      : (joined + "\n" + "id name email posts title body data error extensions select op ".repeat(20)).slice(
          0,
          2048,
        );
  const bytes = new TextEncoder().encode(seed);
  const sha256 = hashDictionary(bytes);
  return {
    id: opts?.id ?? `flux-dict-${sha256.slice(0, 12)}`,
    bytes,
    sha256,
    match: opts?.match ?? "/flux.*",
  };
}

/** Build from schema-ish tokens (field names, type names). */
export function buildDictionaryFromTokens(
  tokens: string[],
  opts?: { id?: string; match?: string },
): FluxDictionary {
  return buildDictionaryFromSamples(tokens, opts);
}

/** Derive a shared dictionary from a Flux schema (field/type/rpc names). */
export function dictionaryFromSchema(
  schema: FluxSchema,
  opts?: { id?: string; match?: string },
): FluxDictionary {
  const tokens: string[] = [schema.package];
  for (const t of schema.types) {
    tokens.push(t.name);
    for (const f of t.fields) tokens.push(f.name, f.typeName);
  }
  for (const s of schema.services) {
    tokens.push(s.name);
    for (const r of s.rpcs) tokens.push(r.name, r.input, r.output);
  }
  tokens.push("data", "error", "extensions", "input", "select", "op", "cost");
  return buildDictionaryFromTokens(tokens, {
    id: opts?.id ?? `flux-${schema.package.replace(/\./g, "-")}`,
    match: opts?.match ?? "/flux.*",
  });
}

export function encodeDcz(payload: Uint8Array, dict: FluxDictionary): Uint8Array {
  const compressed = zstdCompress(payload, dict.bytes);
  const hash = Buffer.from(dict.sha256, "hex");
  if (hash.length !== 32) throw new Error("dictionary sha256 must be 32 bytes");
  const out = new Uint8Array(4 + 32 + 4 + compressed.length);
  out.set(DCZ_MAGIC, 0);
  out.set(hash, 4);
  // reserved / original size hint (uint32 BE) — informational
  new DataView(out.buffer).setUint32(36, payload.length, false);
  out.set(compressed, 40);
  return out;
}

export function decodeDcz(data: Uint8Array, dict: FluxDictionary): Uint8Array {
  if (data.length < 40) throw new Error("truncated dcz");
  if (data[0] !== DCZ_MAGIC[0] || data[1] !== DCZ_MAGIC[1] || data[2] !== DCZ_MAGIC[2] || data[3] !== DCZ_MAGIC[3]) {
    throw new Error("invalid dcz magic");
  }
  const hashHex = Buffer.from(data.subarray(4, 36)).toString("hex");
  if (hashHex !== dict.sha256) throw new Error("dcz dictionary hash mismatch");
  return zstdDecompress(data.subarray(40), dict.bytes);
}

export function encodeDcb(payload: Uint8Array, dict: FluxDictionary): Uint8Array {
  // Shared Brotli with dictionary via Node's brotli is limited; embed dict hash + gzip-of-payload fallback is wrong.
  // Use brotli without shared params + header for Flux-client interoperability (dict used as content seed in zstd path preferred).
  const compressed = brotliCompressSync(payload);
  const hash = Buffer.from(dict.sha256, "hex");
  const out = new Uint8Array(4 + 32 + compressed.length);
  out.set(DCB_MAGIC, 0);
  out.set(hash, 4);
  out.set(compressed, 36);
  return out;
}

export function decodeDcb(data: Uint8Array, dict: FluxDictionary): Uint8Array {
  if (data.length < 36) throw new Error("truncated dcb");
  if (data[0] !== DCB_MAGIC[0] || data[1] !== DCB_MAGIC[1] || data[2] !== DCB_MAGIC[2] || data[3] !== DCB_MAGIC[3]) {
    throw new Error("invalid dcb magic");
  }
  const hashHex = Buffer.from(data.subarray(4, 36)).toString("hex");
  if (hashHex !== dict.sha256) throw new Error("dcb dictionary hash mismatch");
  return brotliDecompressSync(data.subarray(36));
}

/** Parse `Available-Dictionary: :<base64url-sha256>:` style header (simplified). */
export function parseAvailableDictionary(header: string | string[] | undefined): string | null {
  if (!header) return null;
  const raw = Array.isArray(header) ? header[0]! : header;
  const m = raw.match(/:([A-Za-z0-9_-]+):/);
  if (m) {
    try {
      return Buffer.from(m[1]!, "base64url").toString("hex");
    } catch {
      /* fall through */
    }
  }
  // Also accept raw hex sha256
  if (/^[a-f0-9]{64}$/i.test(raw.trim())) return raw.trim().toLowerCase();
  return null;
}

export function formatAvailableDictionary(sha256Hex: string): string {
  const b64 = Buffer.from(sha256Hex, "hex").toString("base64url");
  return `:${b64}:`;
}

export function formatUseAsDictionary(dict: FluxDictionary, path = "/flux/dictionary"): string {
  const match = dict.match ?? "/flux.*";
  return `match="${match}", id="${dict.id}"`;
  // Clients fetch `path` to obtain bytes; Link header also used.
  void path;
}
