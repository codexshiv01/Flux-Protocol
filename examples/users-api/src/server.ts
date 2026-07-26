import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlux } from "@flux/idl";
import { FluxServer, productionOptions } from "@flux/runtime";
import { sseFallbackUrl } from "@flux/webtransport";

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "../public");
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

const flux =
  process.env.FLUX_PRODUCTION === "1"
    ? new FluxServer(
        productionOptions({
          schema,
          enableFlatbuffers: true,
          authenticate: async (req) => {
            // Demo production auth: Authorization: Bearer demo
            const auth = req.headers.authorization;
            if (auth === "Bearer demo") return { roles: ["admin"], principal: "demo" };
            return null;
          },
        }),
      )
    : new FluxServer({ schema, enableFlatbuffers: true, preferEncoding: "identity" });

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

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  let path = req.url?.split("?")[0] ?? "/";
  if (path === "/" || path === "/demo") path = "/index.html";
  const file = join(publicDir, path);
  if (!file.startsWith(publicDir) || !existsSync(file)) return false;
  const body = readFileSync(file);
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(body);
  return true;
}

const port = Number(process.env.PORT ?? 8787);
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        protocol: "flux/1",
        demo: "/demo",
        docs: "/docs",
        sseExample: sseFallbackUrl(
          `http://localhost:${port}/`,
          "flux.v1.UserService/WatchUser",
          { id: "u_1" },
          { id: true, name: true },
        ),
        webtransport: {
          status: "client-adapters-shipped",
          note: "Use @flux/webtransport; browsers need HTTPS WT terminator. SSE is the L3 fallback.",
        },
      }),
    );
    return;
  }
  if (serveStatic(req, res)) return;
  void flux.handle(req, res);
});

server.listen(port, () => {
  console.log(`Flux users-api listening on http://localhost:${port}`);
  console.log(`Browser demo: http://localhost:${port}/demo`);
});
