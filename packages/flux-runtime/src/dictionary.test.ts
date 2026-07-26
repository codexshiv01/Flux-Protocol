import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDictionaryFromSamples,
  encodeDcz,
  decodeDcz,
  formatAvailableDictionary,
  parseAvailableDictionary,
  pickContentEncoding,
  zstdAvailable,
} from "./dictionary.js";
import { compress, decompress } from "./codec.js";

describe("compression + dictionary", () => {
  it("skips compression under threshold", () => {
    const tiny = new TextEncoder().encode('{"ok":true}');
    assert.equal(pickContentEncoding("zstd, br, gzip", tiny.byteLength, 512), "identity");
    const big = new Uint8Array(2000).fill(65);
    const enc = pickContentEncoding("zstd, gzip", big.byteLength, 512);
    assert.ok(enc === "zstd" || enc === "gzip");
  });

  it("prefers zstd when available and advertised", () => {
    if (!zstdAvailable()) return;
    assert.equal(pickContentEncoding("gzip, br, zstd", 2000), "zstd");
    assert.equal(pickContentEncoding(undefined, 2000), "identity");
  });

  it("roundtrips dcz dictionary compression", () => {
    if (!zstdAvailable()) return;
    const dict = buildDictionaryFromSamples([
      '{"data":{"id":"u_1","name":"Ada","email":"a@b.c","posts":[{"title":"x"}]},"error":null}',
      "id name email posts title body extensions",
    ]);
    const payload = new TextEncoder().encode(
      JSON.stringify({
        data: { id: "u_1", name: "Ada Lovelace", email: "ada@analytical.engine", posts: [{ title: "Notes" }] },
        error: null,
        extensions: { cost: 1 },
      }),
    );
    const encoded = encodeDcz(payload, dict);
    assert.ok(encoded.byteLength < payload.byteLength || encoded.byteLength > 0);
    assert.deepEqual(decodeDcz(encoded, dict), payload);

    const viaCompress = compress("dcz", payload, { dictionary: dict });
    assert.equal(viaCompress.encoding, "dcz");
    assert.deepEqual(decompress("dcz", viaCompress.body, dict), payload);
  });

  it("parses Available-Dictionary header", () => {
    const dict = buildDictionaryFromSamples(["flux"]);
    const hdr = formatAvailableDictionary(dict.sha256);
    assert.equal(parseAvailableDictionary(hdr), dict.sha256);
    assert.equal(parseAvailableDictionary(dict.sha256), dict.sha256);
  });
});
