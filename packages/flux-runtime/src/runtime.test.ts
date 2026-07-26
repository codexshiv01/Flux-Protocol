import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlux } from "@flux/idl";
import { FluxServer, createFluxHttpServer, FluxClient, encodeProto, decodeProto, hashSelection } from "./index.js";

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "../../../schema/user.flux");

describe("flux-runtime", () => {
  it("roundtrips proto codec", () => {
    const value = { input: { id: "u_1" }, select: { id: true, name: true } };
    const buf = encodeProto(value);
    assert.deepEqual(decodeProto(buf), value);
  });

  it("serves unary JSON with selection and GET", async () => {
    const schema = parseFlux(readFileSync(schemaPath, "utf8"));
    const flux = new FluxServer({ schema });
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

    server.close();
  });
});
