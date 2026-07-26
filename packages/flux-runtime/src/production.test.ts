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
  productionOptions,
  hashSelection,
} from "./index.js";

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "../../../schema/user.flux");

function listen(flux: FluxServer): Promise<{ baseUrl: string; close: () => void }> {
  const server = createServer(createFluxHttpServer(flux));
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => server.close(),
      });
    });
  });
}

function registerDemo(flux: FluxServer) {
  flux.register("UserService", {
    GetUser: (input) => ({
      id: (input as { id: string }).id,
      name: "Ada",
      email: "ada@example.com",
      posts: [{ id: "p1", title: "Notes", body: "x" }],
    }),
    WatchUser: async function* () {
      yield { id: "u_1", name: "Ada", email: "a", posts: [] };
    },
    Heartbeat: (i) => i,
  });
}

describe("production hardening", () => {
  it("rejects missing protocol version, huge bodies, and unauthenticated calls", async () => {
    const schema = parseFlux(readFileSync(schemaPath, "utf8"));
    const flux = new FluxServer(
      productionOptions({
        schema,
        maxBodyBytes: 64,
        rateLimit: { windowMs: 60_000, maxRequests: 1000 },
        authenticate: async (req) => {
          const auth = req.headers.authorization;
          if (auth === "Bearer good") return { roles: ["admin"], principal: "user-1" };
          return null;
        },
      }),
    );
    registerDemo(flux);
    const { baseUrl, close } = await listen(flux);

    const noVer = await fetch(`${baseUrl}/flux.v1.UserService/GetUser`, {
      method: "POST",
      headers: { "Content-Type": "application/flux+json" },
      body: JSON.stringify({ input: { id: "u_1" }, select: { id: true } }),
    });
    assert.equal(noVer.status, 400);

    const unauth = await fetch(`${baseUrl}/flux.v1.UserService/GetUser`, {
      method: "POST",
      headers: {
        "Content-Type": "application/flux+json",
        "Flux-Protocol-Version": "1",
      },
      body: JSON.stringify({ input: { id: "u_1" }, select: { id: true } }),
    });
    assert.equal(unauth.status, 401);

    const ok = await fetch(`${baseUrl}/flux.v1.UserService/GetUser`, {
      method: "POST",
      headers: {
        "Content-Type": "application/flux+json",
        "Flux-Protocol-Version": "1",
        Authorization: "Bearer good",
      },
      body: JSON.stringify({ input: { id: "u_1" }, select: { id: true, name: true } }),
    });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { data: { name: string } };
    assert.equal(body.data.name, "Ada");

    const huge = "x".repeat(200);
    const tooBig = await fetch(`${baseUrl}/flux.v1.UserService/GetUser`, {
      method: "POST",
      headers: {
        "Content-Type": "application/flux+json",
        "Flux-Protocol-Version": "1",
        Authorization: "Bearer good",
      },
      body: JSON.stringify({ input: { id: huge }, select: { id: true } }),
    });
    assert.equal(tooBig.status, 413);

    close();
  });

  it("enforces strict APQ allowlist and batch size", async () => {
    const schema = parseFlux(readFileSync(schemaPath, "utf8"));
    const select = { id: true as const, name: true as const };
    const op = hashSelection(select);
    const flux = new FluxServer(
      productionOptions({
        schema,
        authenticate: async () => ({ roles: [], principal: "svc" }),
        maxBatchSize: 2,
      }),
    );
    registerDemo(flux);
    // not allowlisted yet
    const client = new FluxClient({
      baseUrl: "http://invalid",
    });
    void client;

    const { baseUrl, close } = await listen(flux);
    const miss = await fetch(`${baseUrl}/flux.v1.UserService/GetUser`, {
      method: "POST",
      headers: {
        "Content-Type": "application/flux+json",
        "Flux-Protocol-Version": "1",
      },
      body: JSON.stringify({ input: { id: "u_1" }, select, op }),
    });
    const missBody = (await miss.json()) as { error: { code: string } };
    assert.equal(missBody.error.code, "persisted_op_not_found");

    flux.apq.allow(op, select);
    const hit = await fetch(`${baseUrl}/flux.v1.UserService/GetUser`, {
      method: "POST",
      headers: {
        "Content-Type": "application/flux+json",
        "Flux-Protocol-Version": "1",
      },
      body: JSON.stringify({ input: { id: "u_1" }, op }),
    });
    assert.equal(hit.status, 200);

    const batch = await fetch(`${baseUrl}/flux.v1.$batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/flux+json",
        "Flux-Protocol-Version": "1",
      },
      body: JSON.stringify({
        batch: [
          { id: "1", procedure: "flux.v1.UserService/GetUser", input: { id: "u_1" }, op },
          { id: "2", procedure: "flux.v1.UserService/GetUser", input: { id: "u_1" }, op },
          { id: "3", procedure: "flux.v1.UserService/GetUser", input: { id: "u_1" }, op },
        ],
      }),
    });
    assert.equal(batch.status, 400);

    close();
  });

  it("rate limits abusive clients", async () => {
    const schema = parseFlux(readFileSync(schemaPath, "utf8"));
    const flux = new FluxServer(
      productionOptions({
        schema,
        rateLimit: { windowMs: 60_000, maxRequests: 3 },
        authenticate: async () => ({ roles: [] }),
      }),
    );
    registerDemo(flux);
    const { baseUrl, close } = await listen(flux);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/flux.v1.UserService/GetUser`, {
        method: "POST",
        headers: {
          "Content-Type": "application/flux+json",
          "Flux-Protocol-Version": "1",
        },
        body: JSON.stringify({ input: { id: "u_1" }, select: { id: true } }),
      });
      statuses.push(res.status);
    }
    assert.ok(statuses.filter((s) => s === 429).length >= 1);
    close();
  });
});
