import {
  CONTENT_TYPES,
  compress,
  decodeResponse,
  encodeRequest,
  type CodecName,
} from "./codec.js";
import { decodeFrames, FRAME_END, FRAME_MESSAGE } from "./stream.js";
import type { FluxRequest, FluxResponse, SelectionSet } from "./types.js";

export interface FluxClientOptions {
  baseUrl: string;
  codec?: CodecName;
  headers?: Record<string, string>;
  roles?: string[];
  compression?: "identity" | "gzip" | "br" | "zstd";
  fetch?: typeof fetch;
}

export class FluxClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: FluxClientOptions) {
    this.fetchFn = opts.fetch ?? fetch;
  }

  async call<TInput, TData>(
    procedurePath: string,
    input: TInput,
    select?: SelectionSet,
    op?: string,
  ): Promise<FluxResponse<TData>> {
    const codec = this.opts.codec ?? "json";
    const envelope: FluxRequest<TInput> = { input, select, op };
    const body = encodeRequest(codec, envelope);
    const { encoding, body: encoded } = compress(this.opts.compression, body);
    const headers: Record<string, string> = {
      "Content-Type": CONTENT_TYPES[codec],
      "Flux-Protocol-Version": "1",
      ...(this.opts.headers ?? {}),
    };
    if (this.opts.roles?.length) headers["Flux-Roles"] = this.opts.roles.join(",");
    if (encoding !== "identity") headers["Content-Encoding"] = encoding;

    const res = await this.fetchFn(join(this.opts.baseUrl, procedurePath), {
      method: "POST",
      headers,
      body: encoded as unknown as BodyInit,
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    // Fetch API already decodes Content-Encoding; do not decompress again.
    return decodeResponse(codec, buf) as FluxResponse<TData>;
  }

  async callGet<TInput extends object, TData>(
    procedurePath: string,
    input: TInput,
    select?: SelectionSet,
    op?: string,
  ): Promise<FluxResponse<TData>> {
    const codec = this.opts.codec ?? "json";
    const url = new URL(join(this.opts.baseUrl, procedurePath));
    url.searchParams.set("encoding", codec === "proto" ? "proto" : "json");
    url.searchParams.set("message", JSON.stringify(input));
    if (select) url.searchParams.set("select", JSON.stringify(select));
    if (op) url.searchParams.set("op", op);
    const headers: Record<string, string> = {
      "Flux-Protocol-Version": "1",
      ...(this.opts.headers ?? {}),
    };
    if (this.opts.roles?.length) headers["Flux-Roles"] = this.opts.roles.join(",");
    const res = await this.fetchFn(url, { method: "GET", headers });
    const buf = new Uint8Array(await res.arrayBuffer());
    return decodeResponse(codec, buf) as FluxResponse<TData>;
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
}

function join(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
