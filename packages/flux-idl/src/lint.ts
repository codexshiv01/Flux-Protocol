import type { FluxSchema } from "./ast.js";

export interface LintIssue {
  severity: "error" | "warning";
  message: string;
}

const SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID", "Bytes"]);

export function lintSchema(schema: FluxSchema): LintIssue[] {
  const issues: LintIssue[] = [];
  if (!schema.package) issues.push({ severity: "error", message: "package declaration required" });

  const typeNames = new Set(schema.types.map((t) => t.name));
  for (const t of schema.types) {
    const seen = new Set<string>();
    for (const f of t.fields) {
      if (seen.has(f.name)) {
        issues.push({ severity: "error", message: `Duplicate field ${t.name}.${f.name}` });
      }
      seen.add(f.name);
      if (!SCALARS.has(f.typeName) && !typeNames.has(f.typeName)) {
        issues.push({
          severity: "error",
          message: `Unknown type ${f.typeName} on ${t.name}.${f.name}`,
        });
      }
    }
  }

  for (const svc of schema.services) {
    for (const rpc of svc.rpcs) {
      if (!typeNames.has(rpc.input)) {
        issues.push({ severity: "error", message: `${svc.name}.${rpc.name}: unknown input ${rpc.input}` });
      }
      if (!typeNames.has(rpc.output)) {
        issues.push({
          severity: "error",
          message: `${svc.name}.${rpc.name}: unknown output ${rpc.output}`,
        });
      }
      const idempotent = rpc.directives.some((d) => d.name === "idempotent");
      if (idempotent && rpc.streaming) {
        issues.push({
          severity: "warning",
          message: `${svc.name}.${rpc.name}: @idempotent on streaming RPC is ignored for GET`,
        });
      }
    }
  }
  return issues;
}

export function breakingChanges(prev: FluxSchema, next: FluxSchema): LintIssue[] {
  const issues: LintIssue[] = [];
  const prevTypes = new Map(prev.types.map((t) => [t.name, t]));
  for (const [name, pt] of prevTypes) {
    const nt = next.types.find((t) => t.name === name);
    if (!nt) {
      issues.push({ severity: "error", message: `Removed type ${name}` });
      continue;
    }
    for (const pf of pt.fields) {
      const nf = nt.fields.find((f) => f.name === pf.name);
      if (!nf) {
        issues.push({ severity: "error", message: `Removed field ${name}.${pf.name}` });
        continue;
      }
      if (pf.nonNull && !nf.nonNull) {
        issues.push({
          severity: "error",
          message: `Field ${name}.${pf.name} changed from non-null to nullable`,
        });
      }
      if (pf.typeName !== nf.typeName || pf.isList !== nf.isList) {
        issues.push({
          severity: "error",
          message: `Field ${name}.${pf.name} type changed`,
        });
      }
    }
  }

  for (const svc of prev.services) {
    const nsvc = next.services.find((s) => s.name === svc.name);
    if (!nsvc) {
      issues.push({ severity: "error", message: `Removed service ${svc.name}` });
      continue;
    }
    for (const rpc of svc.rpcs) {
      if (!nsvc.rpcs.find((r) => r.name === rpc.name)) {
        issues.push({ severity: "error", message: `Removed RPC ${svc.name}.${rpc.name}` });
      }
    }
  }
  return issues;
}
