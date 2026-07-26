import type { FluxSchema } from "./ast.js";

export function emitOpenApi(schema: FluxSchema): object {
  const paths: Record<string, unknown> = {};
  for (const svc of schema.services) {
    for (const rpc of svc.rpcs) {
      const path = `/${schema.package}.${svc.name}/${rpc.name}`;
      const idempotent = rpc.directives.some((d) => d.name === "idempotent");
      const postOp: Record<string, unknown> = {
        operationId: `${svc.name}_${rpc.name}`,
        requestBody: {
          required: true,
          content: {
            "application/flux+json": {
              schema: { $ref: `#/components/schemas/FluxRequest_${rpc.input}` },
            },
          },
        },
        responses: {
          "200": {
            description: "Flux unary response",
            content: {
              "application/flux+json": {
                schema: { $ref: `#/components/schemas/FluxResponse_${rpc.output}` },
              },
            },
          },
        },
      };
      const item: Record<string, unknown> = { post: postOp };
      if (idempotent && !rpc.streaming) {
        item.get = {
          operationId: `${svc.name}_${rpc.name}_get`,
          parameters: [
            { name: "encoding", in: "query", schema: { type: "string", enum: ["json", "proto"] } },
            { name: "message", in: "query", schema: { type: "string" } },
            { name: "select", in: "query", schema: { type: "string" } },
            { name: "op", in: "query", schema: { type: "string" } },
          ],
          responses: postOp.responses,
        };
      }
      paths[path] = item;
    }
  }

  const components: Record<string, unknown> = { schemas: {} as Record<string, unknown> };
  const schemas = components.schemas as Record<string, unknown>;
  for (const t of schema.types) {
    const props: Record<string, unknown> = {};
    const required: string[] = [];
    for (const f of t.fields) {
      props[f.name] = openApiProp(f.typeName, f.isList);
      if (f.nonNull) required.push(f.name);
    }
    schemas[t.name] = {
      type: "object",
      properties: props,
      required: required.length ? required : undefined,
    };
    if (t.kind === "input") {
      schemas[`FluxRequest_${t.name}`] = {
        type: "object",
        properties: {
          input: { $ref: `#/components/schemas/${t.name}` },
          select: { type: "object", additionalProperties: true },
          op: { type: "string" },
        },
      };
    } else {
      schemas[`FluxResponse_${t.name}`] = {
        type: "object",
        properties: {
          data: { $ref: `#/components/schemas/${t.name}` },
          error: { type: "object", nullable: true },
          extensions: { type: "object", additionalProperties: true },
        },
      };
    }
  }

  return {
    openapi: "3.1.0",
    info: { title: `Flux ${schema.package}`, version: "0.1.0" },
    paths,
    components,
  };
}

function openApiProp(typeName: string, isList: boolean): object {
  const scalar: Record<string, object> = {
    String: { type: "string" },
    ID: { type: "string" },
    Int: { type: "integer" },
    Float: { type: "number" },
    Boolean: { type: "boolean" },
    Bytes: { type: "string", format: "byte" },
  };
  const base = scalar[typeName] ?? { $ref: `#/components/schemas/${typeName}` };
  return isList ? { type: "array", items: base } : base;
}

export function emitProto(schema: FluxSchema): string {
  const lines: string[] = [];
  lines.push(`syntax = "proto3";`);
  lines.push(`package ${schema.package.replace(/\./g, ".")};`);
  lines.push("");

  let next = 1;
  const fieldNum = () => next++;

  for (const t of schema.types) {
    const keyword = t.kind === "input" ? "message" : "message";
    lines.push(`${keyword} ${t.name} {`);
    next = 1;
    for (const f of t.fields) {
      const repeated = f.isList ? "repeated " : "";
      lines.push(`  ${repeated}${protoType(f.typeName)} ${f.name} = ${fieldNum()};`);
    }
    lines.push(`}`);
    lines.push("");
  }

  for (const svc of schema.services) {
    lines.push(`service ${svc.name} {`);
    for (const rpc of svc.rpcs) {
      const out = rpc.streaming ? `stream ${rpc.output}` : rpc.output;
      lines.push(`  rpc ${rpc.name}(${rpc.input}) returns (${out});`);
    }
    lines.push(`}`);
    lines.push("");
  }
  return lines.join("\n");
}

function protoType(t: string): string {
  switch (t) {
    case "String":
    case "ID":
      return "string";
    case "Int":
      return "int32";
    case "Float":
      return "double";
    case "Boolean":
      return "bool";
    case "Bytes":
      return "bytes";
    default:
      return t;
  }
}
