#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseFlux } from "./parse.js";
import { generateTypescript } from "./codegen.js";
import { emitOpenApi, emitProto } from "./emit.js";
import { lintSchema, breakingChanges } from "./lint.js";

function usage() {
  console.log(`flux-idl <command>

Commands:
  codegen --schema <file> --out <dir>
  lint --schema <file>
  breaking --prev <file> --next <file>
  emit-openapi --schema <file> --out <file>
  emit-proto --schema <file> --out <file>
`);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const cmd = process.argv[2];
if (!cmd || cmd === "-h" || cmd === "--help") {
  usage();
  process.exit(0);
}

if (cmd === "codegen") {
  const schemaPath = arg("--schema");
  const outDir = arg("--out");
  if (!schemaPath || !outDir) {
    usage();
    process.exit(1);
  }
  const schema = parseFlux(readFileSync(resolve(schemaPath), "utf8"));
  const issues = lintSchema(schema);
  for (const i of issues) console.error(`${i.severity}: ${i.message}`);
  if (issues.some((i) => i.severity === "error")) process.exit(1);
  mkdirSync(resolve(outDir), { recursive: true });
  writeFileSync(resolve(outDir, "schema.ts"), generateTypescript(schema));
  writeFileSync(resolve(outDir, "openapi.json"), JSON.stringify(emitOpenApi(schema), null, 2));
  writeFileSync(resolve(outDir, "schema.proto"), emitProto(schema));
  console.log(`Wrote generated files to ${outDir}`);
  process.exit(0);
}

if (cmd === "lint") {
  const schemaPath = arg("--schema");
  if (!schemaPath) {
    usage();
    process.exit(1);
  }
  const schema = parseFlux(readFileSync(resolve(schemaPath), "utf8"));
  const issues = lintSchema(schema);
  for (const i of issues) console.log(`${i.severity}: ${i.message}`);
  process.exit(issues.some((i) => i.severity === "error") ? 1 : 0);
}

if (cmd === "breaking") {
  const prevPath = arg("--prev");
  const nextPath = arg("--next");
  if (!prevPath || !nextPath) {
    usage();
    process.exit(1);
  }
  const prev = parseFlux(readFileSync(resolve(prevPath), "utf8"));
  const next = parseFlux(readFileSync(resolve(nextPath), "utf8"));
  const issues = breakingChanges(prev, next);
  for (const i of issues) console.log(`${i.severity}: ${i.message}`);
  process.exit(issues.some((i) => i.severity === "error") ? 1 : 0);
}

if (cmd === "emit-openapi" || cmd === "emit-proto") {
  const schemaPath = arg("--schema");
  const out = arg("--out");
  if (!schemaPath || !out) {
    usage();
    process.exit(1);
  }
  const schema = parseFlux(readFileSync(resolve(schemaPath), "utf8"));
  const abs = resolve(out);
  if (!existsSync(dirname(abs))) mkdirSync(dirname(abs), { recursive: true });
  if (cmd === "emit-openapi") {
    writeFileSync(abs, JSON.stringify(emitOpenApi(schema), null, 2));
  } else {
    writeFileSync(abs, emitProto(schema));
  }
  console.log(`Wrote ${abs}`);
  process.exit(0);
}

usage();
process.exit(1);
