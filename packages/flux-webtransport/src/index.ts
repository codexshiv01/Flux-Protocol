/**
 * Flux L3 WebTransport adapters.
 *
 * WebTransport is Baseline in major browsers (2026). Node servers typically
 * terminate WT via a reverse proxy or a QUIC stack. This package provides:
 * - Browser client helper using global WebTransport
 * - Server-side session handler interface + SSE fallback bridge
 * - Datagram helpers for @datagram procedures
 */

import {
  decodeRequest,
  decodeResponse,
  encodeRequest,
  encodeResponse,
  type CodecName,
  type FluxRequest,
  type FluxResponse,
  type SelectionSet,
} from "@flux/runtime";

export interface FluxWebTransportClientOptions {
  url: string;
  codec?: CodecName;
}

export class FluxWebTransportClient {
  private transport: WebTransport | null = null;

  constructor(private readonly opts: FluxWebTransportClientOptions) {}

  async connect(): Promise<void> {
    if (typeof WebTransport === "undefined") {
      throw new Error("WebTransport is not available in this runtime");
    }
    this.transport = new WebTransport(this.opts.url);
    await this.transport.ready;
  }

  async close(): Promise<void> {
    this.transport?.close();
    this.transport = null;
  }

  async callUnary<TInput, TData>(
    procedure: string,
    input: TInput,
    select?: SelectionSet,
  ): Promise<FluxResponse<TData>> {
    const wt = this.requireTransport();
    const stream = await wt.createBidirectionalStream();
    const codec = this.opts.codec ?? "json";
    const writer = stream.writable.getWriter();
    const envelope: FluxRequest<TInput> = { input, select };
    const header = new TextEncoder().encode(JSON.stringify({ procedure }));
    await writer.write(asBufferSource(encodeLengthPrefixed(header)));
    await writer.write(asBufferSource(encodeLengthPrefixed(encodeRequest(codec, envelope))));
    await writer.close();

    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new Uint8Array(value));
    }
    const buf = concat(chunks);
    const { payload } = readLengthPrefixed(buf, 0);
    return decodeResponse(codec, payload) as FluxResponse<TData>;
  }

  async *callBidiStream<TInput, TData>(
    procedure: string,
    input: TInput,
    select?: SelectionSet,
  ): AsyncGenerator<FluxResponse<TData>> {
    const wt = this.requireTransport();
    const stream = await wt.createBidirectionalStream();
    const codec = this.opts.codec ?? "json";
    const writer = stream.writable.getWriter();
    const header = new TextEncoder().encode(JSON.stringify({ procedure }));
    await writer.write(asBufferSource(encodeLengthPrefixed(header)));
    await writer.write(
      asBufferSource(
        encodeLengthPrefixed(encodeRequest(codec, { input, select } satisfies FluxRequest<TInput>)),
      ),
    );

    const reader = stream.readable.getReader();
    let buffer: Uint8Array = new Uint8Array(0);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = concat([buffer, new Uint8Array(value)]);
      while (buffer.length >= 4) {
        const len = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(0, false);
        if (buffer.length < 4 + len) break;
        const payload = buffer.subarray(4, 4 + len);
        buffer = buffer.subarray(4 + len);
        yield decodeResponse(codec, payload) as FluxResponse<TData>;
      }
    }
    await writer.close();
  }

  async sendDatagram(procedure: string, input: unknown): Promise<void> {
    const wt = this.requireTransport();
    const codec = this.opts.codec ?? "json";
    const writer = wt.datagrams.writable.getWriter();
    const header = new TextEncoder().encode(JSON.stringify({ procedure }));
    const body = encodeRequest(codec, { input });
    await writer.write(
      asBufferSource(concat([encodeLengthPrefixed(header), encodeLengthPrefixed(body)])),
    );
    writer.releaseLock();
  }

  private requireTransport(): WebTransport {
    if (!this.transport) throw new Error("Call connect() first");
    return this.transport;
  }
}

/** Server-side session handler contract (wire into your WT terminator). */
export interface FluxWebTransportSession {
  procedureFromUrl(url: string): string | null;
  handleUnary(procedure: string, request: FluxRequest): Promise<FluxResponse>;
  handleStream(procedure: string, request: FluxRequest): AsyncIterable<FluxResponse>;
  handleDatagram(procedure: string, request: FluxRequest): Promise<void>;
}

export async function pumpBidirectionalStream(
  stream: {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  },
  session: FluxWebTransportSession,
  codec: CodecName = "json",
): Promise<void> {
  const reader = stream.readable.getReader();
  let buffer: Uint8Array = new Uint8Array(0);
  const first = await reader.read();
  if (first.done || !first.value) return;
  buffer = new Uint8Array(first.value);
  const header = readLengthPrefixed(buffer, 0);
  const meta = JSON.parse(new TextDecoder().decode(header.payload)) as { procedure: string };
  buffer = buffer.subarray(header.next);
  if (buffer.length < 4) {
    const more = await reader.read();
    if (!more.done && more.value) buffer = concat([buffer, new Uint8Array(more.value)]);
  }
  const body = readLengthPrefixed(buffer, 0);
  const request = decodeRequest(codec, body.payload);
  const writer = stream.writable.getWriter();

  const maybeStream = meta.procedure.includes("Watch");
  if (maybeStream) {
    for await (const msg of session.handleStream(meta.procedure, request)) {
      await writer.write(asBufferSource(encodeLengthPrefixed(encodeResponse(codec, msg))));
    }
  } else {
    const msg = await session.handleUnary(meta.procedure, request);
    await writer.write(asBufferSource(encodeLengthPrefixed(encodeResponse(codec, msg))));
  }
  await writer.close();
}

export function sseFallbackUrl(
  httpBase: string,
  procedure: string,
  input: object,
  select?: SelectionSet,
): string {
  const url = new URL(procedure, httpBase.endsWith("/") ? httpBase : httpBase + "/");
  url.searchParams.set("format", "sse");
  url.searchParams.set("message", JSON.stringify(input));
  if (select) url.searchParams.set("select", JSON.stringify(select));
  return url.toString();
}

function asBufferSource(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
}

function encodeLengthPrefixed(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(payload, 4);
  return out;
}

function readLengthPrefixed(
  buf: Uint8Array,
  offset: number,
): { payload: Uint8Array; next: number } {
  const len = new DataView(buf.buffer, buf.byteOffset + offset, 4).getUint32(0, false);
  const start = offset + 4;
  return { payload: buf.subarray(start, start + len), next: start + len };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
