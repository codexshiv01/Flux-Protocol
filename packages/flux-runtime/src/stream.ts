/** Length-prefixed stream frames: flags(1) + len(4 BE) + payload */

export const FRAME_MESSAGE = 0x00;
export const FRAME_END = 0x01;

export function encodeFrame(flags: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = flags;
  new DataView(out.buffer).setUint32(1, payload.length, false);
  out.set(payload, 5);
  return out;
}

export function* decodeFrames(buf: Uint8Array): Generator<{ flags: number; payload: Uint8Array }> {
  let offset = 0;
  while (offset + 5 <= buf.length) {
    const flags = buf[offset];
    const len = new DataView(buf.buffer, buf.byteOffset + offset + 1, 4).getUint32(0, false);
    offset += 5;
    if (offset + len > buf.length) break;
    yield { flags, payload: buf.subarray(offset, offset + len) };
    offset += len;
  }
}
