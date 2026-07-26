import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const certDir = join(root, "../certs");
mkdirSync(certDir, { recursive: true });

const keyPath = join(certDir, "key.pem");
const certPath = join(certDir, "cert.pem");
const hashPath = join(certDir, "cert-hash.json");
const force = process.argv.includes("--force");

if (!force && existsSync(keyPath) && existsSync(certPath) && existsSync(hashPath)) {
  console.log("certs already exist:", certDir, "(pass --force to regenerate)");
  process.exit(0);
}

/**
 * WebTransport serverCertificateHashes only accepts short-lived ECDSA certs
 * (Chrome / W3C). RSA self-signed certs fail the WT handshake even if HTTPS works.
 */
const opensslCandidates = [
  process.env.OPENSSL_PATH,
  "openssl",
  "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
  "C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe",
].filter(Boolean);

let opensslBin = null;
for (const candidate of opensslCandidates) {
  try {
    execFileSync(candidate, ["version"], { stdio: "ignore" });
    opensslBin = candidate;
    break;
  } catch {
    /* try next */
  }
}

if (!opensslBin) {
  console.error("OpenSSL not found. Install Git for Windows (includes openssl) or OpenSSL.");
  process.exit(1);
}

execFileSync(
  opensslBin,
  [
    "req",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-keyout",
    keyPath,
    "-x509",
    "-out",
    certPath,
    "-days",
    "10",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ],
  { stdio: "inherit" },
);

const pem = readFileSync(certPath, "utf8");
const x509 = new X509Certificate(pem);
const der = x509.raw; // DER-encoded certificate
const hash = createHash("sha256").update(der).digest();
const hashJson = {
  algorithm: "sha-256",
  // hex for embedding; browser gets Uint8Array
  sha256Hex: hash.toString("hex"),
  sha256Base64: hash.toString("base64"),
  note: "SHA-256 of DER certificate for WebTransport serverCertificateHashes",
};
writeFileSync(hashPath, JSON.stringify(hashJson, null, 2));

console.log("Generated ECDSA P-256 certs in", certDir, "via", opensslBin);
console.log("WebTransport cert hash (sha-256):", hashJson.sha256Hex);
console.log("Validity must stay ≤ 14 days for serverCertificateHashes.");
