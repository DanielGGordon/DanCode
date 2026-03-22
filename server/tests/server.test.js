import { describe, it, expect, afterAll } from 'vitest';
import { app, httpServer, startServer } from '../src/index.js';

const TEST_PORT = 3099;

describe('DanCode server', () => {
  let server;

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('starts and listens on the specified port', async () => {
    server = await startServer(TEST_PORT);
    const addr = server.address();
    expect(addr.port).toBe(TEST_PORT);
  });

  it('serves a placeholder page with "DanCode" at /', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('DanCode');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('returns HTML content type for /', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('uses Solarized Dark background color', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`);
    const html = await res.text();
    expect(html).toContain('#002b36');
  });
});
