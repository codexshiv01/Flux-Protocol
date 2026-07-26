import type { IncomingMessage, ServerResponse } from "node:http";
import type { FluxSchema, RpcDef, ServiceDef } from "@flux/idl";
import { ApqStore } from "./apq.js";
import {
  CONTENT_TYPES,
  codecFromContentType,
  compress,
  decodeRequest,
  decompress,
  encodeResponse,
  etagFor,
  type CodecName,
} from "./codec.js";
import {
  clientKey,
  createRateLimiter,
  mergeAuthContext,
  rateLimitConsume,
  type AuthenticateFn,
  type RateLimitState,
} from "./production.js";
import { validateAndProject, hashSelection } from "./select.js";
import { encodeFrame, FRAME_END, FRAME_MESSAGE } from "./stream.js";
import {
  httpStatusFor,
  type FluxContext,
  type FluxError,
  type FluxRequest,
  type FluxResponse,
  type SelectionSet,
} from "./types.js";

export type RpcHandler = (
  input: unknown,
  ctx: FluxContext,
) => Promise<unknown> | unknown | AsyncIterable<unknown>;

export interface RegisteredService {
  def: ServiceDef;
  handlers: Record<string, RpcHandler>;
}

export interface FluxServerOptions {
  schema: FluxSchema;
  maxCost?: number;
  maxDepth?: number;
  preferEncoding?: string;
  enableFlatbuffers?: boolean;
  /** Reject unknown APQ ops unless pre-allowlisted */
  strictApq?: boolean;
  /** Max request body size in bytes (default unlimited in dev; production preset sets 1MiB) */
  maxBodyBytes?: number;
  /** Max operations in a batch */
  maxBatchSize?: number;
  /** Require Flux-Protocol-Version: 1 */
  requireProtocolVersion?: boolean;
  /** When true (default if authenticate set), ignore Flux-Roles header */
  trustRoleHeader?: boolean;
  /** Production authn hook — return null to reject as unauthenticated */
  authenticate?: AuthenticateFn;
  /** Simple in-memory rate limit */
  rateLimit?: { windowMs: number; maxRequests: number };
}

export class FluxServer {
  readonly apq: ApqStore;
  private readonly services = new Map<string, RegisteredService>();
  private readonly limiter: RateLimitState | null;

  constructor(private readonly opts: FluxServerOptions) {
    this.apq = new ApqStore({ strict: opts.strictApq });
    this.limiter = opts.rateLimit
      ? createRateLimiter(opts.rateLimit.windowMs, opts.rateLimit.maxRequests)
      : null;
  }

  register(serviceName: string, handlers: Record<string, RpcHandler>): void {
    const def = this.opts.schema.services.find((s) => s.name === serviceName);
    if (!def) throw new Error(`Unknown service ${serviceName}`);
    this.services.set(serviceName, { def, handlers });
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (this.limiter && !rateLimitConsumeSafe(this.limiter, clientKey(req))) {
        this.writeError(res, "json", { code: "resource_exhausted", message: "rate limit exceeded" }, 429, req);
        return;
      }

      if (this.opts.requireProtocolVersion) {
        const ver = req.headers["flux-protocol-version"];
        const isGet = req.method === "GET";
        // Allow GET health-like without version only for non-procedure paths; procedures still need it
        if (!isGet && ver !== "1") {
          this.writeError(
            res,
            "json",
            { code: "invalid_argument", message: "Flux-Protocol-Version: 1 required" },
            400,
            req,
          );
          return;
        }
        if (isGet && ver && ver !== "1") {
          this.writeError(
            res,
            "json",
            { code: "invalid_argument", message: "Flux-Protocol-Version: 1 required" },
            400,
            req,
          );
          return;
        }
      }

      const host = req.headers.host ?? "localhost";
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname.endsWith("/flux.v1.$batch") || url.pathname.endsWith("/$batch")) {
        await this.handleBatch(req, res);
        return;
      }
      const parsed = parseProcedurePath(url.pathname, this.opts.schema.package);
      if (!parsed) {
        this.writeError(res, "json", { code: "not_found", message: "unknown path" }, 404, req);
        return;
      }
      if (this.opts.requireProtocolVersion && req.method === "GET" && req.headers["flux-protocol-version"] !== "1") {
        // For production GET, require version header (query clients should send it)
        this.writeError(
          res,
          "json",
          { code: "invalid_argument", message: "Flux-Protocol-Version: 1 required" },
          400,
          req,
        );
        return;
      }
      const svc = this.services.get(parsed.service);
      const rpc = svc?.def.rpcs.find((r) => r.name === parsed.procedure);
      const handler = svc?.handlers[parsed.procedure];
      if (!svc || !rpc || !handler) {
        this.writeError(res, "json", { code: "unimplemented", message: "RPC not registered" }, 501, req);
        return;
      }

      let ctx = this.contextFrom(req);
      if (this.opts.authenticate) {
        const auth = await this.opts.authenticate(req);
        if (!auth) {
          this.writeError(res, "json", { code: "unauthenticated", message: "authentication required" }, 401, req);
          return;
        }
        const trust = this.opts.trustRoleHeader === true;
        ctx = mergeAuthContext(ctx, auth, trust);
      } else if (this.opts.trustRoleHeader === false) {
        ctx = { ...ctx, roles: [] };
      }

      const timeout = Number(req.headers["flux-timeout-ms"] ?? "");
      if (timeout > 0) {
        const ac = new AbortController();
        ctx.signal = ac.signal;
        setTimeout(() => ac.abort(), timeout);
      }

      if (
        rpc.streaming &&
        req.method === "GET" &&
        (url.searchParams.get("format") === "sse" || req.headers.accept?.includes("text/event-stream"))
      ) {
        await this.handleSse(req, res, rpc, handler, url, ctx);
        return;
      }

      if (req.method === "GET") {
        await this.handleGet(req, res, rpc, handler, url, ctx);
        return;
      }

      if (req.method !== "POST") {
        this.writeError(res, "json", { code: "invalid_argument", message: "method not allowed" }, 405, req);
        return;
      }

      if (rpc.streaming) {
        await this.handleStreamPost(req, res, rpc, handler, ctx);
        return;
      }

      await this.handleUnaryPost(req, res, rpc, handler, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        message.includes("request body too large") ? ("invalid_argument" as const) : ("internal" as const);
      this.writeError(res, "json", { code, message }, code === "invalid_argument" ? 413 : 500, req);
    }
  }

  private contextFrom(req: IncomingMessage): FluxContext {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers[k.toLowerCase()] = v;
      else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(",");
    }
    const rolesHeader = headers["flux-roles"] ?? "";
    const roles = rolesHeader
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    return {
      headers,
      roles,
      traceparent: headers["traceparent"],
      tracestate: headers["tracestate"],
    };
  }

  private async readBody(req: IncomingMessage): Promise<Uint8Array> {
    const max = this.opts.maxBodyBytes;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const c of req) {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      total += buf.length;
      if (typeof max === "number" && total > max) {
        throw new Error("request body too large");
      }
      chunks.push(buf);
    }
    const raw = new Uint8Array(Buffer.concat(chunks));
    return decompress(req.headers["content-encoding"], raw);
  }

  private resolveSelect(envelope: FluxRequest): { select?: SelectionSet; error?: FluxError } {
    if (envelope.op) {
      const stored = this.apq.get(envelope.op);
      if (stored) return { select: stored };
      if (envelope.select) {
        const hash = hashSelection(envelope.select);
        if (hash !== envelope.op) {
          return { error: { code: "invalid_argument", message: "op hash does not match select" } };
        }
        if (this.apq.strict) {
          return {
            error: {
              code: "persisted_op_not_found",
              message: "Strict APQ: operation not allowlisted",
            },
          };
        }
        this.apq.set(envelope.op, envelope.select);
        return { select: envelope.select };
      }
      return {
        error: {
          code: "persisted_op_not_found",
          message: "Persisted operation not found; retry with select",
        },
      };
    }
    if (envelope.select) {
      this.apq.register(envelope.select);
      return { select: envelope.select };
    }
    return { select: undefined };
  }

  private negotiateEncoding(req?: IncomingMessage): string | undefined {
    // Prefer identity for curl/fetch simplicity unless caller asked for compression.
    // (Browsers send Accept-Encoding; double-decoding with fetch is unsafe.)
    if (this.opts.preferEncoding && this.opts.preferEncoding !== "identity") {
      return this.opts.preferEncoding;
    }
    return undefined;
  }

  private async handleUnaryPost(
    req: IncomingMessage,
    res: ServerResponse,
    rpc: RpcDef,
    handler: RpcHandler,
    ctx: FluxContext,
  ): Promise<void> {
    const codec = codecFromContentType(req.headers["content-type"]);
    if (codec === "flatbuffers" && !this.opts.enableFlatbuffers) {
      this.writeError(res, "json", { code: "unimplemented", message: "flatbuffers disabled" }, 415, req);
      return;
    }
    const body = await this.readBody(req);
    const envelope = decodeRequest(codec, body);
    const version = req.headers["flux-protocol-version"];
    if (version && version !== "1") {
      this.writeError(res, codec, { code: "invalid_argument", message: "unsupported protocol version" }, 400, req);
      return;
    }
    const resolved = this.resolveSelect(envelope);
    if (resolved.error) {
      this.writeJsonish(res, codec, { data: null, error: resolved.error }, httpStatusFor(resolved.error.code), undefined, req);
      return;
    }
    let raw: unknown;
    try {
      raw = await handler(envelope.input, ctx);
    } catch (err) {
      const fluxErr = toFluxError(err);
      this.writeJsonish(res, codec, { data: null, error: fluxErr }, httpStatusFor(fluxErr.code), undefined, req);
      return;
    }
    const projected = validateAndProject(
      this.opts.schema,
      rpc.output,
      raw,
      resolved.select,
      ctx.roles,
      { maxCost: this.opts.maxCost, maxDepth: this.opts.maxDepth },
    );
    const response: FluxResponse = {
      data: projected.data,
      error:
        projected.errors.length === 0
          ? null
          : projected.errors.length === 1
            ? projected.errors[0]
            : projected.errors,
      extensions: { cost: projected.cost },
    };
    const cache = rpc.directives.find((d) => d.name === "cache");
    const maxAge = cache && typeof cache.args.maxAge === "number" ? cache.args.maxAge : undefined;
    this.writeJsonish(res, codec, response, 200, maxAge, req);
  }

  private async handleGet(
    req: IncomingMessage,
    res: ServerResponse,
    rpc: RpcDef,
    handler: RpcHandler,
    url: URL,
    ctx: FluxContext,
  ): Promise<void> {
    const idempotent = rpc.directives.some((d) => d.name === "idempotent");
    if (!idempotent || rpc.streaming) {
      this.writeError(res, "json", { code: "invalid_argument", message: "GET not allowed" }, 405, req);
      return;
    }
    const encoding = (url.searchParams.get("encoding") ?? "json") as CodecName;
    const codec: CodecName =
      encoding === "proto" ? "proto" : encoding === "flatbuffers" ? "flatbuffers" : "json";
    let messageRaw = url.searchParams.get("message") ?? "{}";
    let selectRaw = url.searchParams.get("select") ?? undefined;
    if (url.searchParams.get("base64") === "1") {
      messageRaw = Buffer.from(messageRaw, "base64url").toString("utf8");
      if (selectRaw) selectRaw = Buffer.from(selectRaw, "base64url").toString("utf8");
    }
    const envelope: FluxRequest = {
      input: JSON.parse(messageRaw),
      select: selectRaw ? (JSON.parse(selectRaw) as SelectionSet) : undefined,
      op: url.searchParams.get("op") ?? undefined,
    };
    const resolved = this.resolveSelect(envelope);
    if (resolved.error) {
      this.writeJsonish(res, codec, { data: null, error: resolved.error }, httpStatusFor(resolved.error.code), undefined, req);
      return;
    }
    let raw: unknown;
    try {
      raw = await handler(envelope.input, ctx);
    } catch (err) {
      const fluxErr = toFluxError(err);
      this.writeJsonish(res, codec, { data: null, error: fluxErr }, httpStatusFor(fluxErr.code), undefined, req);
      return;
    }
    const projected = validateAndProject(
      this.opts.schema,
      rpc.output,
      raw,
      resolved.select,
      ctx.roles,
      { maxCost: this.opts.maxCost, maxDepth: this.opts.maxDepth },
    );
    const cache = rpc.directives.find((d) => d.name === "cache");
    const maxAge = cache && typeof cache.args.maxAge === "number" ? cache.args.maxAge : 60;
    const tag = etagFor(projected.data);
    const inm = req.headers["if-none-match"];
    if (inm && inm === tag) {
      const headers: Record<string, string> = {
        ETag: tag,
        "Cache-Control": `public, max-age=${maxAge}`,
        "Flux-Protocol-Version": "1",
      };
      this.applyTraceHeaders(headers, req);
      res.writeHead(304, headers);
      res.end();
      return;
    }
    this.writeJsonish(
      res,
      codec,
      {
        data: projected.data,
        error: projected.errors.length ? projected.errors : null,
        extensions: { cost: projected.cost, cache: { ttl: maxAge } },
      },
      200,
      maxAge,
      req,
      tag,
    );
  }

  private async handleSse(
    req: IncomingMessage,
    res: ServerResponse,
    rpc: RpcDef,
    handler: RpcHandler,
    url: URL,
    ctx: FluxContext,
  ): Promise<void> {
    const messageRaw = url.searchParams.get("message") ?? "{}";
    const selectRaw = url.searchParams.get("select");
    const input = JSON.parse(messageRaw);
    const select = selectRaw ? (JSON.parse(selectRaw) as SelectionSet) : undefined;
    const headers: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    };
    this.applyTraceHeaders(headers, req);
    res.writeHead(200, headers);
    const iter = (await handler(input, ctx)) as AsyncIterable<unknown>;
    for await (const item of iter) {
      const projected = validateAndProject(this.opts.schema, rpc.output, item, select, ctx.roles, {
        maxCost: this.opts.maxCost,
        maxDepth: this.opts.maxDepth,
      });
      const payload = JSON.stringify({
        data: projected.data,
        error: projected.errors.length ? projected.errors : null,
        extensions: { cost: projected.cost },
      });
      res.write(`data: ${payload}\n\n`);
    }
    res.write(`event: end\ndata: {}\n\n`);
    res.end();
  }

  private async handleStreamPost(
    req: IncomingMessage,
    res: ServerResponse,
    rpc: RpcDef,
    handler: RpcHandler,
    ctx: FluxContext,
  ): Promise<void> {
    const codec = codecFromContentType(
      req.headers["content-type"]?.replace("-stream", "") ?? "application/flux+json",
    );
    const body = await this.readBody(req);
    const envelope = decodeRequest(
      codec === "proto" ? "proto" : codec === "flatbuffers" ? "flatbuffers" : "json",
      body,
    );
    const resolved = this.resolveSelect(envelope);
    if (resolved.error) {
      this.writeError(res, "json", resolved.error, httpStatusFor(resolved.error.code), req);
      return;
    }
    const headers: Record<string, string> = {
      "Content-Type": codec === "proto" ? "application/flux-stream+proto" : "application/flux-stream+json",
    };
    this.applyTraceHeaders(headers, req);
    res.writeHead(200, headers);
    const iter = (await handler(envelope.input, ctx)) as AsyncIterable<unknown>;
    const outCodec: CodecName = codec === "proto" ? "proto" : "json";
    for await (const item of iter) {
      const projected = validateAndProject(
        this.opts.schema,
        rpc.output,
        item,
        resolved.select,
        ctx.roles,
        { maxCost: this.opts.maxCost, maxDepth: this.opts.maxDepth },
      );
      const framePayload = encodeResponse(outCodec, {
        data: projected.data,
        error: projected.errors.length ? projected.errors : null,
        extensions: { cost: projected.cost },
      });
      res.write(Buffer.from(encodeFrame(FRAME_MESSAGE, framePayload)));
    }
    res.write(
      Buffer.from(
        encodeFrame(FRAME_END, encodeResponse(outCodec, { data: null, error: null })),
      ),
    );
    res.end();
  }

  private async handleBatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const codec = codecFromContentType(req.headers["content-type"]);
    const body = await this.readBody(req);
    const parsed = decodeRequest(codec, body) as unknown as {
      batch: Array<{
        id: string;
        procedure: string;
        input: unknown;
        select?: SelectionSet;
        op?: string;
      }>;
    };
    const maxBatch = this.opts.maxBatchSize ?? 100;
    if ((parsed.batch?.length ?? 0) > maxBatch) {
      this.writeError(
        res,
        codec,
        { code: "invalid_argument", message: `batch exceeds maxBatchSize (${maxBatch})` },
        400,
        req,
      );
      return;
    }
    const ctx = this.contextFrom(req);
    const results = [];
    for (const item of parsed.batch ?? []) {
      const [pkgSvc, procedure] = splitProcedure(item.procedure);
      const serviceName = pkgSvc?.split(".").pop() ?? "";
      const svc = this.services.get(serviceName);
      const rpc = svc?.def.rpcs.find((r) => r.name === procedure);
      const handler = svc?.handlers[procedure ?? ""];
      if (!svc || !rpc || !handler || rpc.streaming) {
        results.push({
          id: item.id,
          data: null,
          error: { code: "unimplemented", message: "batch item failed" },
        });
        continue;
      }
      const resolved = this.resolveSelect({
        input: item.input,
        select: item.select,
        op: item.op,
      });
      if (resolved.error) {
        results.push({ id: item.id, data: null, error: resolved.error });
        continue;
      }
      const raw = await handler(item.input, ctx);
      const projected = validateAndProject(
        this.opts.schema,
        rpc.output,
        raw,
        resolved.select,
        ctx.roles,
        { maxCost: this.opts.maxCost, maxDepth: this.opts.maxDepth },
      );
      results.push({
        id: item.id,
        data: projected.data,
        error: projected.errors.length ? projected.errors : null,
        extensions: { cost: projected.cost },
      });
    }
    this.writeJsonish(res, codec, { results } as unknown as FluxResponse, 200, undefined, req);
  }

  private applyTraceHeaders(headers: Record<string, string>, req?: IncomingMessage): void {
    const tp = req?.headers["traceparent"];
    const ts = req?.headers["tracestate"];
    if (typeof tp === "string") headers.traceparent = tp;
    if (typeof ts === "string") headers.tracestate = ts;
  }

  private writeError(
    res: ServerResponse,
    codec: CodecName,
    error: FluxError,
    status: number,
    req?: IncomingMessage,
  ): void {
    this.writeJsonish(res, codec, { data: null, error }, status, undefined, req);
  }

  private writeJsonish(
    res: ServerResponse,
    codec: CodecName,
    body: FluxResponse | { results: unknown },
    status: number,
    maxAge?: number,
    req?: IncomingMessage,
    etag?: string,
  ): void {
    const raw = encodeResponse(codec, body as FluxResponse);
    const negotiated = this.negotiateEncoding(req);
    const { encoding, body: encoded } = compress(negotiated, raw);
    const headers: Record<string, string> = {
      "Content-Type": CONTENT_TYPES[codec],
      "Flux-Protocol-Version": "1",
    };
    if (encoding !== "identity") headers["Content-Encoding"] = encoding;
    if (typeof maxAge === "number") headers["Cache-Control"] = `public, max-age=${maxAge}`;
    if (etag) headers.ETag = etag;
    else if ("data" in body) headers.ETag = etagFor((body as FluxResponse).data);
    this.applyTraceHeaders(headers, req);
    res.writeHead(status, headers);
    res.end(Buffer.from(encoded));
  }
}

function parseProcedurePath(
  pathname: string,
  _pkg: string,
): { service: string; procedure: string } | null {
  const parts = pathname.split("/").filter(Boolean);
  const leaf = parts[parts.length - 1];
  const prev = parts[parts.length - 2];
  if (!leaf || !prev) return null;
  if (prev.includes(".")) {
    return { service: prev.split(".").pop()!, procedure: leaf };
  }
  return { service: prev, procedure: leaf };
}

function splitProcedure(procedure: string): [string, string] {
  const idx = procedure.lastIndexOf("/");
  if (idx < 0) return [procedure, ""];
  return [procedure.slice(0, idx), procedure.slice(idx + 1)];
}

function toFluxError(err: unknown): FluxError {
  if (err && typeof err === "object") {
    const e = err as { code?: string; message?: string };
    const code = (e.code as FluxError["code"]) ?? "internal";
    return { code, message: e.message ?? "internal error" };
  }
  return { code: "internal", message: String(err) };
}

function rateLimitConsumeSafe(state: RateLimitState, key: string): boolean {
  return rateLimitConsume(state, key);
}

export function createFluxHttpServer(server: FluxServer) {
  return (req: IncomingMessage, res: ServerResponse) => {
    void server.handle(req, res);
  };
}
