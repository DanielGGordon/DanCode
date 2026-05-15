import { describe, it, expect } from 'vitest';
import {
  encodeFrame,
  FrameDecoder,
  makeRequest,
  makeResponse,
  makeEvent,
  FRAME_HEADER_BYTES,
} from '../src/wire.js';

describe('wire protocol', () => {
  it('encodes a request frame as [length][JSON]', () => {
    const frame = makeRequest('req-1', 'spawn', { projectSlug: 'demo' });
    const buf = encodeFrame(frame);

    const length = buf.readUInt32BE(0);
    expect(length).toBe(buf.length - FRAME_HEADER_BYTES);
    const json = buf.slice(FRAME_HEADER_BYTES).toString('utf8');
    expect(JSON.parse(json)).toEqual(frame);
  });

  it('rejects encoding non-object frames', () => {
    expect(() => encodeFrame(null)).toThrow(TypeError);
    expect(() => encodeFrame('hi')).toThrow(TypeError);
  });

  it('rejects encoding frames with invalid type', () => {
    expect(() => encodeFrame({ type: 'nope', op: 'x' })).toThrow(TypeError);
  });

  it('decodes a single frame from a single chunk', () => {
    const frame = makeResponse('req-1', true, { terminalId: 'abc' });
    const buf = encodeFrame(frame);

    const decoder = new FrameDecoder();
    const seen = [];
    decoder.onFrame = (f) => seen.push(f);
    decoder.push(buf);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(frame);
  });

  it('decodes a frame split across many chunks (byte-by-byte)', () => {
    const frame = makeEvent('term-99', 'output', { data: 'hello\n' });
    const buf = encodeFrame(frame);

    const decoder = new FrameDecoder();
    const seen = [];
    decoder.onFrame = (f) => seen.push(f);
    for (let i = 0; i < buf.length; i++) {
      decoder.push(buf.slice(i, i + 1));
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(frame);
  });

  it('decodes multiple frames concatenated in one chunk', () => {
    const f1 = makeRequest('r1', 'list', {});
    const f2 = makeRequest('r2', 'kill', { terminalId: 't1' });
    const f3 = makeEvent('t1', 'exit', { code: 0 });
    const combined = Buffer.concat([encodeFrame(f1), encodeFrame(f2), encodeFrame(f3)]);

    const decoder = new FrameDecoder();
    const seen = [];
    decoder.onFrame = (f) => seen.push(f);
    decoder.push(combined);

    expect(seen).toEqual([f1, f2, f3]);
  });

  it('reports a JSON parse error via onError but keeps decoding', () => {
    // Manually build a bad-JSON frame followed by a good one.
    const badPayload = Buffer.from('not-json', 'utf8');
    const bad = Buffer.allocUnsafe(FRAME_HEADER_BYTES + badPayload.length);
    bad.writeUInt32BE(badPayload.length, 0);
    badPayload.copy(bad, FRAME_HEADER_BYTES);

    const goodFrame = makeRequest('rN', 'list', {});
    const good = encodeFrame(goodFrame);

    const decoder = new FrameDecoder();
    const seen = [];
    const errors = [];
    decoder.onFrame = (f) => seen.push(f);
    decoder.onError = (e) => errors.push(e);
    decoder.push(Buffer.concat([bad, good]));

    expect(errors).toHaveLength(1);
    expect(seen).toEqual([goodFrame]);
  });

  it('rejects oversized incoming frames', () => {
    // Manufacture a header claiming an absurd size.
    const huge = Buffer.allocUnsafe(FRAME_HEADER_BYTES);
    huge.writeUInt32BE(0xffffffff, 0);

    const decoder = new FrameDecoder();
    const errors = [];
    decoder.onError = (e) => errors.push(e);
    decoder.push(huge);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RangeError);
  });

  it('makeResponse builds {ok:false,error} on error', () => {
    const r = makeResponse('rZ', false, new Error('nope'));
    expect(r).toEqual({
      type: 'res',
      requestId: 'rZ',
      payload: { ok: false, error: 'nope' },
    });
  });
});
