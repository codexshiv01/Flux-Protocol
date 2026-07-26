import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseFlux } from "./parse.js";
import { lintSchema } from "./lint.js";
import { generateTypescript, canonicalizeSelection } from "./codegen.js";
import { emitOpenApi, emitProto } from "./emit.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../schema/user.flux");

describe("flux-idl", () => {
  it("parses user.flux", () => {
    const schema = parseFlux(readFileSync(root, "utf8"));
    assert.equal(schema.package, "flux.v1");
    assert.ok(schema.services.find((s) => s.name === "UserService"));
    const get = schema.services[0].rpcs.find((r) => r.name === "GetUser");
    assert.ok(get?.directives.some((d) => d.name === "idempotent"));
    assert.ok(get?.directives.some((d) => d.name === "cache" && d.args.maxAge === 60));
  });

  it("lints clean schema", () => {
    const schema = parseFlux(readFileSync(root, "utf8"));
    assert.equal(lintSchema(schema).filter((i) => i.severity === "error").length, 0);
  });

  it("generates typescript and emits", () => {
    const schema = parseFlux(readFileSync(root, "utf8"));
    const ts = generateTypescript(schema);
    assert.match(ts, /export interface User/);
    assert.match(ts, /UserServiceHandler/);
    const oa = emitOpenApi(schema) as { paths: Record<string, unknown> };
    assert.ok(oa.paths["/flux.v1.UserService/GetUser"]);
    assert.match(emitProto(schema), /service UserService/);
  });

  it("canonicalizes selection keys", () => {
    assert.equal(
      canonicalizeSelection({ b: true, a: { z: true, y: true } }),
      canonicalizeSelection({ a: { y: true, z: true }, b: true }),
    );
  });
});
