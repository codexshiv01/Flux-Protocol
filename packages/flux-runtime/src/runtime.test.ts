import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlux } from "@flux/idl";
import {
  FluxServer,
  createFluxHttpServer,
  FluxClient,
  encodeProtoRequest,
  decodeProtoRequest,
  encodeProtoResponse,
  decodeProtoResponse,
  encodeFlatbuffers,
  decodeFlatbuffers,
  hashSelection,
  etagFor,
} from "./index.js";

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "../../../schema/user.flux");

describe("flux-runtime", () => {
  it("roundtrips protobuf and flatbuffers codecs", () => {
    const req = { input: { id: "u_1" }, select: { id: true as const, name: true as const }, op: "abc" };
    assert.deepEqual(decodeProtoRequest(encodeProtoRequest(req)), req);
    assert.deepEqual(decodeFlatbuffers(encodeFlatbuffers(req)), req);
    const res = { data: { id: "u_1" }, error: null, extensions: { cost: 1 } };
    assert.deepEqual(decodeProtoResponse(encodeProtoResponse(res)), res);
    assert.deepEqual(decodeFlatbuffers(encodeFlatbuffers(res)), res);
    assert.match(etagFor(res.data), /^"flux-/);
  });

  it("serves unary JSON with selection, GET, ETag, and APQ", async () => {
    const schema = parseFlux(readFileSync(schemaPath, "utf8"));
    const flux = new FluxServer({ schema, enableFlatbuffers: true });
    flux.register("UserService", {
      GetUser: (input) => {
        const id = (input as { id: string }).id;
        return {
          id,
          name: "Ada",
          email: "ada@example.com",
          posts: [
            { id: "p1", title: "Notes", body: "secret" },
            { id: "p2", title: "More", body: "x" },
          ],
        };
      },
      WatchUser: async function* () {
        yield { id: "u_1", name: "Ada", email: "ada@example.com", posts: [] };
      },
      Heartbeat: (input) => input,
    });

    const server = createServer(createFluxHttpServer(flux));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    const client = new FluxClient({ baseUrl });

    const res = await client.call(
      "flux.v1.UserService/GetUser",
      { id: "u_1" },
      { id: true, name: true, posts: { title: true } },
    );
    assert.equal(res.error, null);
    assert.deepEqual(res.data, {
      id: "u_1",
      name: "Ada",
      posts: [{ title: "Notes" }, { title: "More" }],
    });

    const get = await client.callGet(
      "flux.v1.UserService/GetUser",
      { id: "u_1" },
      { id: true, name: true },
    );
    assert.equal((get.data as { name: string }).name, "Ada");

    const select = { id: true as const, name: true as const };
    const op = hashSelection(select);
    const unknownOp = "0".repeat(64);
    const miss = await client.call("flux.v1.UserService/GetUser", { id: "u_1" }, undefined, unknownOp);
    assert.equal((miss.error as { code: string }).code, "persisted_op_not_found");
    const hitRegister = await client.call("flux.v1.UserService/GetUser", { id: "u_1" }, select, op);
    assert.equal(hitRegister.error, null);
    const hit = await client.call("flux.v1.UserService/GetUser", { id: "u_1" }, undefined, op);
    assert.equal((hit.data as { name: string }).name, "Ada");

    const protoClient = new FluxClient({ baseUrl, codec: "proto" });
    const protoRes = await protoClient.call(
      "flux.v1.UserService/GetUser",
      { id: "u_1" },
      { id: true, name: true },
    );
    assert.equal((protoRes.data as { id: string }).id, "u_1");

    const fbClient = new FluxClient({ baseUrl, codec: "flatbuffers" });
    const fbRes = await fbClient.call(
      "flux.v1.UserService/GetUser",
      { id: "u_1" },
      { id: true, name: true },
    );
    assert.equal((fbRes.data as { name: string }).name, "Ada");

    const getUrl = `${baseUrl}/flux.v1.UserService/GetUser?encoding=json&message=${encodeURIComponent(JSON.stringify({ id: "u_1" }))}&select=${encodeURIComponent(JSON.stringify({ id: true }))}`;
    const etagRes = await fetch(getUrl, {
      headers: {
        "Flux-Protocol-Version": "1",
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      },
    });
    assert.equal(etagRes.status, 200);
    assert.ok(etagRes.headers.get("etag"));
    assert.equal(etagRes.headers.get("traceparent")?.startsWith("00-"), true);
    const etag = etagRes.headers.get("etag")!;
    const notModified = await fetch(getUrl, {
      headers: { "If-None-Match": etag, "Flux-Protocol-Version": "1" },
    });
    assert.equal(notModified.status, 304);

    server.close();
  });
});
