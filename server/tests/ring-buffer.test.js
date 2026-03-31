import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../src/terminal-manager.js';

describe('RingBuffer', () => {
  it('stores appended data and returns it via getContents', () => {
    const buf = new RingBuffer(100);
    buf.append('hello ');
    buf.append('world');
    expect(buf.getContents()).toBe('hello world');
  });

  it('uses chunks array internally, not string concatenation', () => {
    const buf = new RingBuffer(1000);
    buf.append('chunk1');
    buf.append('chunk2');
    // Verify internal structure uses chunks array
    expect(Array.isArray(buf.chunks)).toBe(true);
    expect(buf.chunks.length).toBe(2);
    expect(buf.chunks[0]).toBe('chunk1');
    expect(buf.chunks[1]).toBe('chunk2');
  });

  it('append does not use string += concatenation', () => {
    const buf = new RingBuffer(1000);
    // After multiple appends, chunks should remain separate (not merged into one string)
    buf.append('a');
    buf.append('b');
    buf.append('c');
    expect(buf.chunks).toEqual(['a', 'b', 'c']);
    // No 'data' property (old implementation used this.data)
    expect(buf.data).toBeUndefined();
  });

  it('only concatenates in getContents', () => {
    const buf = new RingBuffer(1000);
    buf.append('foo');
    buf.append('bar');
    // Before getContents, chunks are still separate
    expect(buf.chunks.length).toBe(2);
    const result = buf.getContents();
    expect(result).toBe('foobar');
    // getContents should not mutate internal state
    expect(buf.chunks.length).toBe(2);
  });

  it('trims to maxSize when content exceeds limit', () => {
    const buf = new RingBuffer(10);
    buf.append('12345');
    buf.append('67890');
    buf.append('ABCDE');
    const contents = buf.getContents();
    expect(contents.length).toBeLessThanOrEqual(10);
    // Should keep the last 10 characters
    expect(contents).toBe('67890ABCDE');
  });

  it('compacts when totalSize exceeds 2x maxSize', () => {
    const buf = new RingBuffer(10);
    // Append enough to trigger compaction (totalSize > 2 * maxSize = 20)
    buf.append('12345'); // totalSize = 5
    buf.append('67890'); // totalSize = 10
    buf.append('ABCDE'); // totalSize = 15
    buf.append('FGHIJ'); // totalSize = 20
    buf.append('K');     // totalSize = 21, triggers compaction
    // After compaction, chunks should be reduced
    expect(buf.chunks.length).toBe(1);
    expect(buf.getContents().length).toBe(10);
  });

  it('handles empty buffer', () => {
    const buf = new RingBuffer(100);
    expect(buf.getContents()).toBe('');
  });

  it('handles single large append', () => {
    const buf = new RingBuffer(10);
    buf.append('this is a very long string that exceeds the buffer');
    const contents = buf.getContents();
    expect(contents.length).toBe(10);
    expect(contents).toBe('the buffer');
  });

  it('preserves exact content when under maxSize', () => {
    const buf = new RingBuffer(1000);
    const chunks = ['Hello, ', 'this is ', 'a test ', 'of the ', 'ring buffer.'];
    for (const c of chunks) {
      buf.append(c);
    }
    expect(buf.getContents()).toBe('Hello, this is a test of the ring buffer.');
  });
});
