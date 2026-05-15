/**
 * Length-prefixed JSON frames for the shellhost wire protocol.
 *
 * Frame layout on the wire:
 *   [4-byte big-endian uint32 payload length][JSON-encoded payload bytes...]
 *
 * Payload shape:
 *   { type: 'req' | 'res' | 'event', requestId?, terminalId?, op, payload }
 */

const HEADER_BYTES = 4;
const MAX_FRAME_BYTES = 16 * 1024 * 1024; // 16MB safety cap

/**
 * Encode a frame object into a Buffer ready to be written to the socket.
 */
export function encodeFrame(frame) {
  if (frame == null || typeof frame !== 'object') {
    throw new TypeError('encodeFrame requires an object');
  }
  if (frame.type !== 'req' && frame.type !== 'res' && frame.type !== 'event') {
    throw new TypeError(`encodeFrame: invalid frame type ${frame.type}`);
  }
  const json = Buffer.from(JSON.stringify(frame), 'utf8');
  if (json.length > MAX_FRAME_BYTES) {
    throw new RangeError(`encodeFrame: frame size ${json.length} exceeds ${MAX_FRAME_BYTES}`);
  }
  const out = Buffer.allocUnsafe(HEADER_BYTES + json.length);
  out.writeUInt32BE(json.length, 0);
  json.copy(out, HEADER_BYTES);
  return out;
}

/**
 * Stateful streaming decoder. Feed in arbitrary chunks; emits whole frames.
 *
 * Usage:
 *   const decoder = new FrameDecoder();
 *   decoder.onFrame = (frame) => { ... };
 *   socket.on('data', (chunk) => decoder.push(chunk));
 */
export class FrameDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.onFrame = null;
    this.onError = null;
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) {
      chunk = Buffer.from(chunk);
    }
    this.buffer = this.buffer.length === 0
      ? chunk
      : Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= HEADER_BYTES) {
      const len = this.buffer.readUInt32BE(0);
      if (len > MAX_FRAME_BYTES) {
        const err = new RangeError(`FrameDecoder: incoming frame size ${len} exceeds ${MAX_FRAME_BYTES}`);
        this.buffer = Buffer.alloc(0);
        if (this.onError) this.onError(err);
        return;
      }
      if (this.buffer.length < HEADER_BYTES + len) break;

      const payload = this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + len);
      this.buffer = this.buffer.subarray(HEADER_BYTES + len);

      let frame;
      try {
        frame = JSON.parse(payload.toString('utf8'));
      } catch (err) {
        if (this.onError) this.onError(err);
        continue;
      }
      if (this.onFrame) this.onFrame(frame);
    }
  }
}

/**
 * Convenience helpers for the three frame shapes.
 */
export function makeRequest(requestId, op, payload = {}) {
  return { type: 'req', requestId, op, payload };
}

export function makeResponse(requestId, ok, result) {
  if (ok) return { type: 'res', requestId, payload: { ok: true, result } };
  return { type: 'res', requestId, payload: { ok: false, error: String(result?.message || result) } };
}

export function makeEvent(terminalId, op, payload = {}) {
  return { type: 'event', terminalId, op, payload };
}

export const FRAME_HEADER_BYTES = HEADER_BYTES;
export const FRAME_MAX_BYTES = MAX_FRAME_BYTES;
