import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlux } from "@flux/idl";
import { FluxServer } from "@flux/runtime";
import { sseFallbackUrl } from "@flux/webtransport";

const root = dirname(fileURLToPath(import.meta.url));
const schema = parseFlux(readFileSync(join(root, "../../../schema/user.flux"), "utf8"));

const db = new Map([
  [
    "u_1",
    {
      id: "u_1",
      name: "Ada Lovelace",
      email: "ada@analytical.engine",
      posts: [
        { id: "p1", title: "Notes on the Analytical Engine", body: "..." },
        { id: "p2", title: "Bernoulli numbers", body: "..." },
      ],
    },
  ],
]);

const flux = new FluxServer({ schema, enableFlatbuffers: true, preferEncoding: "identity" });

flux.register("UserService", {
  async GetUser(input) {
    const id = (input as { id: string }).id;
    const user = db.get(id);
    if (!user) {
      const err = new Error("user not found") as Error & { code?: string };
      err.code = "not_found";
      throw err;
    }
    return user;
  },
  async *WatchUser(input) {
    const id = (input as { id: string }).id;
    const user = db.get(id);
    if (!user) return;
    for (let i = 0; i < 3; i++) {
      yield { ...user, name: `${user.name} (#${i})` };
      await new Promise((r) => setTimeout(r, 50));
    }
  },
  Heartbeat(input) {
    return input;
  },
});

const port = Number(process.env.PORT ?? 8787);
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        protocol: "flux/1",
        docs: "/docs",
        sseExample: sseFallbackUrl(
          `http://localhost:${port}/`,
          "flux.v1.UserService/WatchUser",
          { id: "u_1" },
          { id: true, name: true },
        ),
      }),
    );
    return;
  }
  void flux.handle(req, res);
});

server.listen(port, () => {
  console.log(`Flux users-api listening on http://localhost:${port}`);
  console.log(`Try:`);
  console.log(
    `  curl -sS -X POST http://localhost:${port}/flux.v1.UserService/GetUser -H "Content-Type: application/flux+json" -H "Flux-Protocol-Version: 1" -d "{\\"input\\":{\\"id\\":\\"u_1\\"},\\"select\\":{\\"id\\":true,\\"name\\":true,\\"posts\\":{\\"title\\":true}}}"`,
  );
});
