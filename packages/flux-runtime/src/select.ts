import { createHash } from "node:crypto";
import type { FluxSchema, TypeDef } from "@flux/idl";
import { canonicalizeSelection } from "@flux/idl";
import type { FluxError, SelectionSet } from "./types.js";

const SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID", "Bytes"]);

export function hashSelection(select: SelectionSet): string {
  return createHash("sha256").update(canonicalizeSelection(select)).digest("hex");
}

export function validateAndProject(
  schema: FluxSchema,
  typeName: string,
  value: unknown,
  select: SelectionSet | undefined,
  roles: string[],
  opts: { maxDepth?: number; maxCost?: number } = {},
): { data: unknown; errors: FluxError[]; cost: number } {
  const types = new Map(schema.types.map((t) => [t.name, t]));
  const maxDepth = opts.maxDepth ?? 16;
  const maxCost = opts.maxCost ?? 1000;
  const errors: FluxError[] = [];
  let cost = 0;

  function walk(
    tName: string,
    val: unknown,
    sel: SelectionSet | undefined,
    path: Array<string | number>,
    depth: number,
  ): unknown {
    if (depth > maxDepth) {
      errors.push({
        code: "invalid_argument",
        message: `Selection depth exceeded ${maxDepth}`,
        path: [...path],
      });
      return null;
    }
    if (val == null) return val;
    const t = types.get(tName);
    if (!t) return val;
    const effective = sel ?? defaultSelect(t);
    if (Array.isArray(val)) {
      return val.map((item, idx) => walk(tName, item, effective, [...path, idx], depth));
    }
    if (typeof val !== "object") return val;
    const obj = val as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [field, sub] of Object.entries(effective)) {
      const fieldDef = t.fields.find((f) => f.name === field);
      if (!fieldDef) {
        errors.push({
          code: "invalid_argument",
          message: `Unknown field ${field} on ${tName}`,
          path: [...path, field],
        });
        continue;
      }
      const auth = fieldDef.directives.find((d) => d.name === "auth");
      if (auth && typeof auth.args.role === "string" && !roles.includes(auth.args.role)) {
        errors.push({
          code: "permission_denied",
          message: `Missing role ${auth.args.role}`,
          path: [...path, field],
        });
        continue;
      }
      const costDir = fieldDef.directives.find((d) => d.name === "cost");
      const fieldCost =
        typeof costDir?.args.value === "number"
          ? costDir.args.value
          : typeof costDir?.args[Object.keys(costDir.args)[0] ?? ""] === "number"
            ? (costDir.args[Object.keys(costDir.args)[0]] as number)
            : 1;
      // @cost(10) style stores under "value" from parser
      const c =
        costDir && "value" in costDir.args && typeof costDir.args.value === "number"
          ? costDir.args.value
          : fieldCost;
      cost += typeof c === "number" ? c : 1;
      if (cost > maxCost) {
        errors.push({
          code: "resource_exhausted",
          message: `Selection cost exceeded ${maxCost}`,
          path: [...path, field],
        });
        break;
      }
      const child = obj[field];
      if (sub === true) {
        if (SCALARS.has(fieldDef.typeName)) {
          out[field] = child;
        } else if (fieldDef.isList && Array.isArray(child)) {
          out[field] = child.map((item, idx) =>
            walk(fieldDef.typeName, item, defaultSelect(types.get(fieldDef.typeName)!), [...path, field, idx], depth + 1),
          );
        } else {
          out[field] = walk(
            fieldDef.typeName,
            child,
            defaultSelect(types.get(fieldDef.typeName)!),
            [...path, field],
            depth + 1,
          );
        }
      } else {
        if (fieldDef.isList && Array.isArray(child)) {
          out[field] = child.map((item, idx) =>
            walk(fieldDef.typeName, item, sub, [...path, field, idx], depth + 1),
          );
        } else {
          out[field] = walk(fieldDef.typeName, child, sub, [...path, field], depth + 1);
        }
      }
    }
    return out;
  }

  const data = walk(typeName, value, select, [], 0);
  return { data, errors, cost };
}

function defaultSelect(t: TypeDef): SelectionSet {
  const sel: SelectionSet = {};
  for (const f of t.fields) {
    const costDir = f.directives.find((d) => d.name === "cost");
    const c = costDir && typeof costDir.args.value === "number" ? costDir.args.value : 0;
    if (c > 0 && !SCALARS.has(f.typeName)) continue; // skip costly nested by default
    sel[f.name] = true;
  }
  return sel;
}
