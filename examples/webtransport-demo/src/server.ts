/**
 * HTTPS WebTransport terminator demo for Flux L3.
 *
 *   npm run certs -w @flux/webtransport-demo
 *   npm start -w @flux/webtransport-demo
 *
 * Self-signed WT requires ECDSA cert + serverCertificateHashes in the browser.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash, X509Certificate } from "node:crypto";
import { createServer as createHttpsServer } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlux } from "@flux/idl";
import {
  FluxServer,
  dictionaryFromSchema,
  type FluxRequest,
  type FluxResponse,
} from "@flux/runtime";
import { acceptFluxWebTransportSession, sseFallbackUrl } from "@flux/webtransport";

const root = dirname(fileURLToPath(import.meta.url));
const certDir = join(root, "../certs");
const keyPath = join(certDir, "key.pem");
const certPath = join(certDir, "cert.pem");
const port = Number(process.env.PORT ?? 4433);

if (!existsSync(keyPath) || !existsSync(certPath)) {
  console.error("Missing TLS certs. Run: npm run certs -w @flux/webtransport-demo -- --force");
  process.exit(1);
}

const schema = parseFlux(readFileSync(join(root, "../../../schema/user.flux"), "utf8"));
const dictionary = dictionaryFromSchema(schema);

const flux = new FluxServer({
  schema,
  autoCompress: true,
  dictionary,
  enableFlatbuffers: true,
});

const user = (id: string, name: string) => ({
  id,
  name,
  email: "ada@analytical.engine",
  posts: [{ id: "p1", title: "Notes", body: "…" }],
});

flux.register("UserService", {
  async GetUser(input) {
    return user((input as { id: string }).id, "Ada Lovelace");
  },
  async *WatchUser(input) {
    const id = (input as { id: string }).id;
    for (let i = 0; i < 3; i++) {
      yield { ...user(id, `Ada (#${i})`), posts: [] };
      await new Promise((r) => setTimeout(r, 40));
    }
  },
  Heartbeat(input) {
    return input;
  },
});

async function handleFluxProcedure(procedure: string, request: FluxRequest): Promise<FluxResponse> {
  const name = procedure.includes("/") ? procedure.split("/").pop()! : procedure;
  try {
    if (name === "GetUser") {
      return { data: user((request.input as { id: string }).id, "Ada Lovelace"), error: null };
    }
    if (name === "Heartbeat") {
      return { data: request.input, error: null };
    }
    return { data: null, error: { code: "unimplemented", message: name } };
  } catch (e) {
    return { data: null, error: { code: "internal", message: String(e) } };
  }
}

const key = readFileSync(keyPath);
const cert = readFileSync(certPath);
const keyPem = key.toString("utf8");
const certPem = cert.toString("utf8");
const x509 = new X509Certificate(cert);
const certHash = createHash("sha256").update(x509.raw).digest();
const certHashBytes = [...certHash];
const notAfter = new Date(x509.validTo);
const daysLeft = (notAfter.getTime() - Date.now()) / (86400 * 1000);
if (daysLeft > 14 || daysLeft <= 0) {
  console.warn(
    `Warning: cert validity window is ${daysLeft.toFixed(1)} days. WebTransport serverCertificateHashes requires ≤ 14 days. Regenerate with: npm run certs:force -w @flux/webtransport-demo`,
  );
}

// Browsers often resolve `localhost` → ::1 first; our QUIC stack listens on IPv4.
// Always use 127.0.0.1 for WebTransport to avoid "Opening handshake failed."
const publicHost = "127.0.0.1";
const origin = `https://${publicHost}:${port}`;

const sseUrl = sseFallbackUrl(
  `${origin}/`,
  "flux.v1.UserService/WatchUser",
  { id: "u_1" },
  { id: true, name: true },
);

const publicHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Flux WebTransport</title>
<style>body{font-family:system-ui;max-width:40rem;margin:2rem auto;padding:0 1rem}
pre{background:#0f172a;color:#e2e8f0;padding:1rem;border-radius:8px;min-height:6rem}
.meta{color:#64748b;font-size:.9rem}</style>
</head><body>
<h1>Flux L3 — WebTransport demo</h1>
<p class="meta">Open via <code>${origin}/</code> (not <code>localhost</code> — IPv6 breaks QUIC here). Uses ECDSA + <code>serverCertificateHashes</code>.</p>
<button id="wt">GetUser over WebTransport</button>
<a href="${sseUrl}">WatchUser SSE fallback</a>
<pre id="out">Ready.</pre>
<script type="module">
const out = document.getElementById("out");
const log = (v) => out.textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2);
const CERT_HASH = new Uint8Array(${JSON.stringify(certHashBytes)});
const WT_URL = "${origin}/flux";
if (location.hostname === "localhost" || location.hostname === "[::1]") {
  log({ note: "Redirecting to 127.0.0.1 for WebTransport/QUIC…", from: location.href, to: WT_URL.replace("/flux","/") });
  location.replace("${origin}/");
}
document.getElementById("wt").onclick = async () => {
  if (typeof WebTransport === "undefined") { log("WebTransport unavailable in this browser"); return; }
  log({ status: "connecting", url: WT_URL });
  try {
    const wt = new WebTransport(WT_URL, {
      serverCertificateHashes: [{ algorithm: "sha-256", value: CERT_HASH }],
    });
    await Promise.race([
      wt.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error("WebTransport ready timeout (5s)")), 5000)),
    ]);
    const stream = await wt.createBidirectionalStream();
    const enc = new TextEncoder();
    const header = enc.encode(JSON.stringify({ procedure: "flux.v1.UserService/GetUser" }));
    const body = enc.encode(JSON.stringify({ input: { id: "u_1" }, select: { id: true, name: true } }));
    const prefix = (u8) => { const o = new Uint8Array(4 + u8.length); new DataView(o.buffer).setUint32(0, u8.length); o.set(u8, 4); return o; };
    const w = stream.writable.getWriter();
    await w.write(prefix(header));
    await w.write(prefix(body));
    await w.close();
    const r = stream.readable.getReader();
    const chunks = [];
    while (true) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const buf = new Uint8Array(total);
    let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
    const len = new DataView(buf.buffer).getUint32(0);
    log({ transport: "webtransport", response: JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + len))) });
    wt.close();
  } catch (e) {
    log({
      error: String(e.message || e),
      url: WT_URL,
      hint: "Use Chrome/Edge. Allow UDP ${port}. Open ${origin}/ (IPv4). Cert ECDSA ≤14d.",
    });
  }
};
</script>
</body></html>`;

const httpsServer = createHttpsServer({ key: keyPem, cert: certPem }, (req, res) => {
  if (req.url === "/" || req.url === "/demo") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(publicHtml);
    return;
  }
  if (req.url === "/cert-hash.json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ algorithm: "sha-256", sha256Hex: Buffer.from(certHash).toString("hex") }));
    return;
  }
  void flux.handle(req, res);
});

httpsServer.listen(port, "0.0.0.0", () => {
  console.log(`Flux HTTPS on ${origin}/  (also https://localhost:${port}/ → redirects to IPv4)`);
  console.log(`Dictionary: GET /flux/dictionary`);
  console.log(`WT cert hash: ${Buffer.from(certHash).toString("hex")}`);
});

try {
  const { Http3Server } = await import("@fails-components/webtransport");
  const h3 = new Http3Server({
    port,
    host: "0.0.0.0",
    secret: process.env.FLUX_WT_SECRET ?? "flux-dev-secret-change-me",
    cert: certPem,
    privKey: keyPem,
  });
  h3.startServer();
  console.log(`HTTP/3 WebTransport on UDP 0.0.0.0:${port} path /flux`);
  console.log(`Open ${origin}/ then click GetUser over WebTransport`);

  (async () => {
    const stream = await h3.sessionStream("/flux");
    const reader = stream.getReader();
    while (true) {
      const { done, value: session } = await reader.read();
      if (done) break;
      console.log("WT session accepted");
      void acceptFluxWebTransportSession(session, {
        handleUnary: handleFluxProcedure,
        async *handleStream(procedure, request) {
          if (!procedure.includes("Watch")) {
            yield await handleFluxProcedure(procedure, request);
            return;
          }
          const id = (request.input as { id: string }).id;
          for (let i = 0; i < 3; i++) {
            yield { data: { ...user(id, `Ada (#${i})`), posts: [] }, error: null };
            await new Promise((r) => setTimeout(r, 40));
          }
        },
      });
    }
  })().catch((err) => console.error("WT session loop:", err));
} catch (err) {
  console.warn(
    "Http3Server unavailable — HTTPS Flux still up. Optional:\n" +
      "  npm i @fails-components/webtransport @fails-components/webtransport-transport-http3-quiche -w @flux/webtransport-demo\n" +
      String((err as Error).message ?? err),
  );
}
