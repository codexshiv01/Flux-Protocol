import {
  CONTENT_TYPES,
  compress,
  decodeResponse,
  decompress,
  encodeRequest,
  type CodecName,
} from "./codec.js";
import {
  formatAvailableDictionary,
  type FluxDictionary,
} from "./dictionary.js";
import {
  RetryBudget,
  withResilience,
  type ResilienceOptions,
  type AttemptOutcome,
} from "./resilience.js";
import { decodeFrames, FRAME_END, FRAME_MESSAGE } from "./stream.js";
import type { FluxRequest, FluxResponse, SelectionSet } from "./types.js";

export interface FluxClientOptions {
  baseUrl: string;
  codec?: CodecName;
  headers?: Record<string, string>;
  roles?: string[];
  /**
   * Request body compression. `auto` picks zstd above threshold.
   * Default: identity (small requests); set `auto` for large inputs.
   */
  compression?: "identity" | "gzip" | "br" | "zstd" | "auto";
  /** Shared compression dictionary (RFC 9842 / Flux dcz). */
  dictionary?: FluxDictionary;
  /** Fetch dictionary from `/flux/dictionary` on first use when true. */
  fetchDictionary?: boolean;
  fetch?: typeof fetch;
  /** Default resilience for all calls (overridable per call). */
  resilience?: ResilienceOptions;
}

export type CallOptions = ResilienceOptions;

export class FluxClient {
  private readonly fetchFn: typeof fetch;
  private readonly budget: RetryBudget | null;
  private dictionary: FluxDictionary | undefined;

  constructor(private readonly opts: FluxClientOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.dictionary = opts.dictionary;
    const r = opts.resilience;
    this.budget =
      !r || r.budget === false || (!r.retry && !r.hedge)
        ? null
        : new RetryBudget(r.budget === undefined ? {} : r.budget);
  }

  async ensureDictionary(): Promise<FluxDictionary | undefined> {
    if (this.dictionary) return this.dictionary;
    if (!this.opts.fetchDictionary) return undefined;
    const res = await this.fetchFn(join(this.opts.baseUrl, "/flux/dictionary"));
    if (!res.ok) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const id = res.headers.get("dictionary-id") ?? `flux-dict-${sha256.slice(0, 12)}`;
    this.dictionary = { id, bytes, sha256 };
    return this.dictionary;
  }

  async call<TInput, TData>(
    procedurePath: string,
    input: TInput,
    select?: SelectionSet,
    opOrOpts?: string | CallOptions,
    maybeOpts?: CallOptions,
  ): Promise<FluxResponse<TData>> {
    const { op, resilience } = splitOpOpts(opOrOpts, maybeOpts);
    const merged = mergeResilience(this.opts.resilience, resilience, {
      idempotent: resilience?.idempotent ?? false,
    });
    return withResilience(
      (signal) => this.postOnce<TInput, TData>(procedurePath, input, select, op, signal, merged),
      {
        ...merged,
        budgetInstance: this.budget ?? undefined,
        classify: classifyFluxResponse,
      },
    );
  }

  async callGet<TInput extends object, TData>(
    procedurePath: string,
    input: TInput,
    select?: SelectionSet,
    opOrOpts?: string | CallOptions,
    maybeOpts?: CallOptions,
  ): Promise<FluxResponse<TData>> {
    const { op, resilience } = splitOpOpts(opOrOpts, maybeOpts);
    const merged = mergeResilience(this.opts.resilience, resilience, {
      idempotent: true,
    });
    return withResilience(
      (signal) => this.getOnce<TInput, TData>(procedurePath, input, select, op, signal, merged),
      {
        ...merged,
        budgetInstance: this.budget ?? undefined,
        classify: classifyFluxResponse,
      },
    );
  }

  async *stream<TInput, TData>(
    procedurePath: string,
    input: TInput,
    select?: SelectionSet,
  ): AsyncGenerator<FluxResponse<TData>> {
    const codec = this.opts.codec ?? "json";
    const envelope: FluxRequest<TInput> = { input, select };
    const body = encodeRequest(codec, envelope);
    const res = await this.fetchFn(join(this.opts.baseUrl, procedurePath), {
      method: "POST",
      headers: {
        "Content-Type": CONTENT_TYPES[codec],
        "Flux-Protocol-Version": "1",
        Accept: codec === "proto" ? "application/flux-stream+proto" : "application/flux-stream+json",
        ...(this.opts.headers ?? {}),
      },
      body: body as unknown as BodyInit,
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    for (const frame of decodeFrames(buf)) {
      const msg = decodeResponse(codec, frame.payload) as FluxResponse<TData>;
      if (frame.flags === FRAME_END) return;
      if (frame.flags === FRAME_MESSAGE) yield msg;
    }
  }

  async *sse<TInput extends object, TData>(
    procedurePath: string,
    input: TInput,
    select?: SelectionSet,
  ): AsyncGenerator<FluxResponse<TData>> {
    const url = new URL(join(this.opts.baseUrl, procedurePath));
    url.searchParams.set("format", "sse");
    url.searchParams.set("message", JSON.stringify(input));
    if (select) url.searchParams.set("select", JSON.stringify(select));
    const res = await this.fetchFn(url, {
      headers: { Accept: "text/event-stream", ...(this.opts.headers ?? {}) },
    });
    const text = await res.text();
    for (const block of text.split("\n\n")) {
      const line = block.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const data = line.slice(6);
      if (data === "{}") continue;
      yield JSON.parse(data) as FluxResponse<TData>;
    }
  }

  private async postOnce<TInput, TData>(
    procedurePath: string,
    input: TInput,
    select: SelectionSet | undefined,
    op: string | undefined,
    signal: AbortSignal | undefined,
    resilience: ResilienceOptions,
  ): Promise<FluxResponse<TData>> {
    await this.ensureDictionary();
    const codec = this.opts.codec ?? "json";
    const envelope: FluxRequest<TInput> = { input, select, op };
    const body = encodeRequest(codec, envelope);
    const compression = this.opts.compression ?? "identity";
    const { encoding, body: encoded } = compress(compression === "auto" ? "auto" : compression, body, {
      encoding: compression,
      acceptEncoding: "zstd, br, gzip",
      dictionary: this.dictionary,
    });
    const headers = this.buildHeaders(codec, encoding, resilience);
    const res = await this.fetchFn(join(this.opts.baseUrl, procedurePath), {
      method: "POST",
      headers,
      body: encoded as unknown as BodyInit,
      signal,
    });
    return this.decodeHttpResponse<TData>(codec, res);
  }

  private async getOnce<TInput extends object, TData>(
    procedurePath: string,
    input: TInput,
    select: SelectionSet | undefined,
    op: string | undefined,
    signal: AbortSignal | undefined,
    resilience: ResilienceOptions,
  ): Promise<FluxResponse<TData>> {
    await this.ensureDictionary();
    const codec = this.opts.codec ?? "json";
    const url = new URL(join(this.opts.baseUrl, procedurePath));
    url.searchParams.set("encoding", codec === "proto" ? "proto" : "json");
    url.searchParams.set("message", JSON.stringify(input));
    if (select) url.searchParams.set("select", JSON.stringify(select));
    if (op) url.searchParams.set("op", op);
    const headers = this.buildHeaders(codec, "identity", resilience, true);
    const res = await this.fetchFn(url, { method: "GET", headers, signal });
    return this.decodeHttpResponse<TData>(codec, res);
  }

  private async decodeHttpResponse<TData>(
    codec: CodecName,
    res: Response,
  ): Promise<FluxResponse<TData>> {
    const buf = new Uint8Array(await res.arrayBuffer());
    const ce = res.headers.get("content-encoding")?.toLowerCase();
    // Fetch auto-decodes gzip/br/zstd; dcz/dcb need manual handling.
    let payload: Uint8Array = buf;
    if (ce === "dcz" || ce === "dcb") {
      payload = new Uint8Array(decompress(ce, buf, this.dictionary));
    }
    const decoded = decodeResponse(codec, payload) as FluxResponse<TData>;
    return attachHttpStatus(decoded, res.status);
  }

  private buildHeaders(
    codec: CodecName,
    encoding: string,
    resilience: ResilienceOptions,
    get = false,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Flux-Protocol-Version": "1",
      "Accept-Encoding": "dcz, zstd, br, gzip",
      ...(this.opts.headers ?? {}),
    };
    if (!get) headers["Content-Type"] = CONTENT_TYPES[codec];
    if (this.opts.roles?.length) headers["Flux-Roles"] = this.opts.roles.join(",");
    if (encoding !== "identity") headers["Content-Encoding"] = encoding;
    if (resilience.timeoutMs && resilience.timeoutMs > 0) {
      headers["Flux-Timeout-Ms"] = String(resilience.timeoutMs);
    }
    if (resilience.priority) headers["Priority"] = resilience.priority;
    if (this.dictionary) {
      headers["Available-Dictionary"] = formatAvailableDictionary(this.dictionary.sha256);
    }
    return headers;
  }
}

type WithHttp = FluxResponse & { __httpStatus?: number };

function attachHttpStatus<T>(res: FluxResponse<T>, status: number): FluxResponse<T> {
  (res as WithHttp).__httpStatus = status;
  return res;
}

function classifyFluxResponse(response: FluxResponse): AttemptOutcome {
  return {
    httpStatus: (response as WithHttp).__httpStatus,
    response,
  };
}

function splitOpOpts(
  opOrOpts?: string | CallOptions,
  maybeOpts?: CallOptions,
): { op?: string; resilience?: CallOptions } {
  if (typeof opOrOpts === "string") return { op: opOrOpts, resilience: maybeOpts };
  if (opOrOpts && typeof opOrOpts === "object") return { resilience: opOrOpts };
  return { resilience: maybeOpts };
}

function mergeResilience(
  base: ResilienceOptions | undefined,
  over: ResilienceOptions | undefined,
  defaults: Partial<ResilienceOptions>,
): ResilienceOptions {
  return {
    ...defaults,
    ...base,
    ...over,
    idempotent: over?.idempotent ?? base?.idempotent ?? defaults.idempotent,
  };
}

function join(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
