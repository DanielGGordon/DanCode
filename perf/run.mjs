#!/usr/bin/env node

/**
 * DanCode Performance Test Suite
 *
 * Runs backend API benchmarks, WebSocket benchmarks, concurrent load tests,
 * and frontend bundle/serving analysis. All from a single command.
 *
 * Usage:
 *   node perf/run.mjs            # Normal run (50 iterations)
 *   node perf/run.mjs --quick    # Quick run (10 iterations)
 *   PERF_ITER=100 node perf/run.mjs   # Custom iteration count
 */

import { mkdtemp, rm, writeFile as fsWriteFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { generate } from 'otplib';

import { bench, formatMs, formatBytes, printTable, printKV } from './helpers.mjs';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const isQuick = process.argv.includes('--quick');
const BASE_ITER = parseInt(process.env.PERF_ITER, 10) || (isQuick ? 10 : 50);
const CONCURRENT_COUNT = parseInt(process.env.PERF_CONCURRENCY, 10) || 20;
const TEST_PORT = 3097;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_USERNAME = 'perfuser';
const TEST_PASSWORD = 'perfpassword123';

// ---------------------------------------------------------------------------
// Setup & Teardown
// ---------------------------------------------------------------------------

let tempDir, server, token, totpSecret, projectSlug, terminalId;

async function setup() {
  console.log('\nDanCode Performance Test Suite');
  console.log('─'.repeat(40));
  console.log(`  Iterations: ${BASE_ITER} (${isQuick ? 'quick' : 'normal'})`);
  console.log(`  Port:       ${TEST_PORT}`);
  console.log(`  Concurrent: ${CONCURRENT_COUNT}`);
  console.log('');

  // Create isolated temp directory
  tempDir = await mkdtemp(join(tmpdir(), 'dancode-perf-'));
  const credentialsPath = join(tempDir, 'credentials.json');
  const projectsDir = join(tempDir, 'projects');
  const terminalsDir = join(tempDir, 'terminals');

  // Create test project directory with sample files
  const testProjectDir = join(tempDir, 'test-project');
  await mkdir(join(testProjectDir, 'src'), { recursive: true });
  await fsWriteFile(join(testProjectDir, 'package.json'), '{"name":"test","version":"1.0.0"}');
  await fsWriteFile(join(testProjectDir, 'README.md'), '# Test Project\n\nSample readme for perf testing.');
  await fsWriteFile(join(testProjectDir, 'src', 'index.js'), 'console.log("hello world");\n'.repeat(50));
  await fsWriteFile(join(testProjectDir, 'src', 'utils.js'), 'export function add(a, b) { return a + b; }\n'.repeat(20));

  // Measure server startup time
  const startupStart = performance.now();
  const { startServer, terminalManager } = await import('../server/src/index.js');
  const { clearSessions } = await import('../server/src/auth.js');
  clearSessions();
  server = await startServer(TEST_PORT, { credentialsPath, projectsDir, terminalsDir });
  const startupMs = performance.now() - startupStart;

  // Setup account
  const setupRes = await fetch(`${BASE_URL}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
  });
  const setupData = await setupRes.json();
  totpSecret = setupData.totpSecret;

  // Login
  const totpCode = await generate({ secret: totpSecret });
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD, totpCode }),
  });
  const loginData = await loginRes.json();
  token = loginData.token;

  // Create a test project pointing at our temp directory
  const projRes = await fetch(`${BASE_URL}/api/projects`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name: 'Perf Test', path: testProjectDir }),
  });
  const projData = await projRes.json();
  projectSlug = projData.slug;

  // Get terminal IDs from the created project
  const termsRes = await fetch(`${BASE_URL}/api/terminals?project=${projectSlug}`, {
    headers: authHeaders(),
  });
  const terminals = await termsRes.json();
  terminalId = terminals[0]?.id;

  const mem = process.memoryUsage();
  printKV('Server Startup', [
    ['Startup time', formatMs(startupMs)],
    ['Memory (RSS)', formatBytes(mem.rss)],
    ['Memory (Heap Used)', formatBytes(mem.heapUsed)],
    ['Memory (Heap Total)', formatBytes(mem.heapTotal)],
    ['Test project', testProjectDir],
  ]);

  return { terminalManager, clearSessions };
}

async function teardown(terminalManager, clearSessions) {
  if (terminalManager) await terminalManager.destroyAll();
  if (server) await new Promise(resolve => server.close(resolve));
  if (clearSessions) clearSessions();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders() {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function fetchOk(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders(), ...opts });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${opts.method || 'GET'} ${path} → ${res.status}: ${text}`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Backend API Benchmarks
// ---------------------------------------------------------------------------

async function runApiLatencyBenchmarks() {
  const results = [];

  // Auth endpoints
  results.push({
    name: 'GET  /auth/setup/status',
    ...await bench(() => fetch(`${BASE_URL}/api/auth/setup/status`), { iterations: BASE_ITER }),
  });

  results.push({
    name: 'POST /auth/validate',
    ...await bench(() => fetch(`${BASE_URL}/api/auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }), { iterations: BASE_ITER }),
  });

  // Project endpoints
  results.push({
    name: 'GET  /projects',
    ...await bench(() => fetchOk('/api/projects'), { iterations: BASE_ITER }),
  });

  results.push({
    name: 'GET  /projects/:slug',
    ...await bench(() => fetchOk(`/api/projects/${projectSlug}`), { iterations: BASE_ITER }),
  });

  results.push({
    name: 'PATCH /projects/:slug',
    ...await bench(() => fetchOk(`/api/projects/${projectSlug}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: `Perf Test ${Date.now()}` }),
    }), { iterations: BASE_ITER }),
  });

  // Terminal endpoints
  results.push({
    name: 'GET  /terminals',
    ...await bench(() => fetchOk(`/api/terminals?project=${projectSlug}`), { iterations: BASE_ITER }),
  });

  if (terminalId) {
    results.push({
      name: 'GET  /terminals/:id',
      ...await bench(() => fetchOk(`/api/terminals/${terminalId}`), { iterations: BASE_ITER }),
    });
  }

  // File endpoints
  results.push({
    name: 'GET  /files (list dir)',
    ...await bench(() => fetchOk(`/api/files?project=${projectSlug}&path=.`), { iterations: BASE_ITER }),
  });

  results.push({
    name: 'GET  /files/read',
    ...await bench(() => fetchOk(`/api/files/read?project=${projectSlug}&path=src/index.js`), { iterations: BASE_ITER }),
  });

  results.push({
    name: 'PUT  /files/write',
    ...await bench(() => fetchOk('/api/files/write', {
      method: 'PUT',
      body: JSON.stringify({
        project: projectSlug,
        path: 'src/bench-output.txt',
        content: `benchmark ${Date.now()}\n`,
      }),
    }), { iterations: BASE_ITER }),
  });

  // HTML page serving
  results.push({
    name: 'GET  / (HTML page)',
    ...await bench(() => fetch(`${BASE_URL}/`), { iterations: BASE_ITER }),
  });

  printTable(`Backend API Latency (${BASE_ITER} iterations, ${isQuick ? 'quick' : 'normal'})`, results);
  return results;
}

// ---------------------------------------------------------------------------
// Terminal CRUD Benchmark (heavier operations)
// ---------------------------------------------------------------------------

async function runTerminalCrudBenchmarks() {
  const iter = Math.max(5, Math.round(BASE_ITER / 5));
  const results = [];

  // Terminal create + destroy cycle
  const createTimings = [];
  const destroyTimings = [];
  for (let i = 0; i < iter; i++) {
    const cs = performance.now();
    const res = await fetchOk('/api/terminals', {
      method: 'POST',
      body: JSON.stringify({ projectSlug, label: `perf-${i}` }),
    });
    createTimings.push(performance.now() - cs);
    const t = await res.json();

    const ds = performance.now();
    await fetchOk(`/api/terminals/${t.id}`, { method: 'DELETE' });
    destroyTimings.push(performance.now() - ds);
  }

  createTimings.sort((a, b) => a - b);
  destroyTimings.sort((a, b) => a - b);
  const sumC = createTimings.reduce((a, b) => a + b, 0);
  const sumD = destroyTimings.reduce((a, b) => a + b, 0);

  results.push({
    name: 'POST /terminals (create)',
    iterations: iter,
    min: createTimings[0],
    max: createTimings[iter - 1],
    mean: sumC / iter,
    p50: createTimings[Math.floor(iter * 0.5)],
    p95: createTimings[Math.floor(iter * 0.95)] || createTimings[iter - 1],
    p99: createTimings[iter - 1],
    rps: Math.round(1000 / (sumC / iter)),
  });

  results.push({
    name: 'DELETE /terminals/:id',
    iterations: iter,
    min: destroyTimings[0],
    max: destroyTimings[iter - 1],
    mean: sumD / iter,
    p50: destroyTimings[Math.floor(iter * 0.5)],
    p95: destroyTimings[Math.floor(iter * 0.95)] || destroyTimings[iter - 1],
    p99: destroyTimings[iter - 1],
    rps: Math.round(1000 / (sumD / iter)),
  });

  printTable(`Terminal CRUD (${iter} iterations — spawns tmux + PTY)`, results);
  return results;
}

// ---------------------------------------------------------------------------
// Concurrent Requests Benchmark
// ---------------------------------------------------------------------------

async function runConcurrentBenchmarks() {
  const rounds = Math.max(3, Math.round(BASE_ITER / 10));
  const roundTimings = [];
  const perRequestTimings = [];

  for (let r = 0; r < rounds; r++) {
    const roundStart = performance.now();
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_COUNT }, async () => {
        const start = performance.now();
        await fetchOk('/api/projects');
        return performance.now() - start;
      })
    );
    roundTimings.push(performance.now() - roundStart);
    perRequestTimings.push(...results);
  }

  roundTimings.sort((a, b) => a - b);
  perRequestTimings.sort((a, b) => a - b);

  const totalRequests = rounds * CONCURRENT_COUNT;
  const totalTime = roundTimings.reduce((a, b) => a + b, 0);
  const avgPerRequest = perRequestTimings.reduce((a, b) => a + b, 0) / perRequestTimings.length;

  printKV(`Concurrent Requests (${CONCURRENT_COUNT} parallel × ${rounds} rounds = ${totalRequests} total)`, [
    ['Avg round time', formatMs(roundTimings.reduce((a, b) => a + b, 0) / rounds)],
    ['Min round time', formatMs(roundTimings[0])],
    ['Max round time', formatMs(roundTimings[roundTimings.length - 1])],
    ['Avg per-request', formatMs(avgPerRequest)],
    ['P95 per-request', formatMs(perRequestTimings[Math.floor(perRequestTimings.length * 0.95)])],
    ['Effective throughput', `${Math.round(totalRequests / (totalTime / 1000))} req/s`],
  ]);

  return { totalRequests, totalTime, avgPerRequest, effectiveRps: Math.round(totalRequests / (totalTime / 1000)) };
}

// ---------------------------------------------------------------------------
// WebSocket Benchmark
// ---------------------------------------------------------------------------

async function runWebSocketBenchmarks() {
  let io;
  try {
    io = (await import('socket.io-client')).io;
  } catch {
    console.log('\n  [skip] socket.io-client not available — skipping WebSocket benchmarks');
    return null;
  }

  if (!terminalId) {
    console.log('\n  [skip] No terminal available — skipping WebSocket benchmarks');
    return null;
  }

  const iter = Math.max(5, Math.round(BASE_ITER / 5));
  const connectTimings = [];
  const roundTripTimings = [];

  for (let i = 0; i < iter; i++) {
    // Measure connection time
    const connStart = performance.now();
    const socket = io(`${BASE_URL}/terminal/${terminalId}`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });

    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
      setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
    });
    connectTimings.push(performance.now() - connStart);

    // Measure round-trip: send input → receive output containing marker
    const marker = `__PERF_${Date.now()}_${i}__`;
    const rtStart = performance.now();
    socket.emit('input', `echo ${marker}\n`);

    await new Promise((resolve) => {
      const handler = (data) => {
        if (data.includes(marker)) {
          socket.off('output', handler);
          resolve();
        }
      };
      socket.on('output', handler);
      setTimeout(resolve, 3000); // timeout fallback
    });
    roundTripTimings.push(performance.now() - rtStart);

    socket.disconnect();
  }

  connectTimings.sort((a, b) => a - b);
  roundTripTimings.sort((a, b) => a - b);

  const results = [
    {
      name: 'WS connect',
      iterations: iter,
      min: connectTimings[0],
      max: connectTimings[iter - 1],
      mean: connectTimings.reduce((a, b) => a + b, 0) / iter,
      p50: connectTimings[Math.floor(iter * 0.5)],
      p95: connectTimings[Math.floor(iter * 0.95)] || connectTimings[iter - 1],
      p99: connectTimings[iter - 1],
      rps: Math.round(1000 / (connectTimings.reduce((a, b) => a + b, 0) / iter)),
    },
    {
      name: 'WS echo round-trip',
      iterations: iter,
      min: roundTripTimings[0],
      max: roundTripTimings[iter - 1],
      mean: roundTripTimings.reduce((a, b) => a + b, 0) / iter,
      p50: roundTripTimings[Math.floor(iter * 0.5)],
      p95: roundTripTimings[Math.floor(iter * 0.95)] || roundTripTimings[iter - 1],
      p99: roundTripTimings[iter - 1],
      rps: Math.round(1000 / (roundTripTimings.reduce((a, b) => a + b, 0) / iter)),
    },
  ];

  printTable(`WebSocket Performance (${iter} iterations)`, results);
  return results;
}

// ---------------------------------------------------------------------------
// Frontend Build Analysis
// ---------------------------------------------------------------------------

async function runFrontendBenchmarks() {
  const distPath = new URL('../client/dist', import.meta.url).pathname;

  if (!existsSync(distPath)) {
    console.log('\n  [skip] client/dist/ not found — run "npm run build -w client" first');
    return null;
  }

  // Walk dist/ and categorize files
  const files = await walkDir(distPath);
  let totalSize = 0;
  let totalGzip = 0;
  const categories = { js: { size: 0, gzip: 0, count: 0 }, css: { size: 0, gzip: 0, count: 0 }, html: { size: 0, gzip: 0, count: 0 }, other: { size: 0, gzip: 0, count: 0 } };

  for (const f of files) {
    const content = await readFile(f.path);
    const gzipped = gzipSync(content);
    totalSize += f.size;
    totalGzip += gzipped.length;

    const ext = extname(f.name).slice(1);
    const cat = categories[ext] || categories.other;
    cat.size += f.size;
    cat.gzip += gzipped.length;
    cat.count++;
  }

  printKV('Frontend Build Analysis', [
    ['Total bundle', `${formatBytes(totalSize)} (gzip: ${formatBytes(totalGzip)})`],
    ['JavaScript', `${formatBytes(categories.js.size)} (gzip: ${formatBytes(categories.js.gzip)}) — ${categories.js.count} files`],
    ['CSS', `${formatBytes(categories.css.size)} (gzip: ${formatBytes(categories.css.gzip)}) — ${categories.css.count} files`],
    ['HTML', `${formatBytes(categories.html.size)} (gzip: ${formatBytes(categories.html.gzip)}) — ${categories.html.count} files`],
    ['Other assets', `${formatBytes(categories.other.size)} — ${categories.other.count} files`],
  ]);

  // Measure asset serving performance through Express
  const servingResults = [];

  servingResults.push({
    name: 'GET / (HTML)',
    ...await bench(() => fetch(`${BASE_URL}/`), { iterations: BASE_ITER }),
  });

  // Find the main JS and CSS bundles
  const jsBundle = files.find(f => f.name.endsWith('.js') && f.name.includes('index'));
  const cssBundle = files.find(f => f.name.endsWith('.css'));

  if (jsBundle) {
    const jsPath = jsBundle.path.replace(distPath, '').replace(/\\/g, '/');
    servingResults.push({
      name: `GET ${jsPath.length > 30 ? '.../' + jsBundle.name : jsPath}`,
      ...await bench(() => fetch(`${BASE_URL}${jsPath}`), { iterations: BASE_ITER }),
    });
  }

  if (cssBundle) {
    const cssPath = cssBundle.path.replace(distPath, '').replace(/\\/g, '/');
    servingResults.push({
      name: `GET ${cssPath.length > 30 ? '.../' + cssBundle.name : cssPath}`,
      ...await bench(() => fetch(`${BASE_URL}${cssPath}`), { iterations: BASE_ITER }),
    });
  }

  printTable(`Frontend Asset Serving (${BASE_ITER} iterations)`, servingResults);

  return { totalSize, totalGzip, categories, serving: servingResults };
}

async function walkDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkDir(fullPath));
    } else {
      const s = await stat(fullPath);
      files.push({ path: fullPath, name: entry.name, size: s.size });
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Memory Snapshot
// ---------------------------------------------------------------------------

function printMemory() {
  const mem = process.memoryUsage();
  printKV('Memory After All Benchmarks', [
    ['RSS', formatBytes(mem.rss)],
    ['Heap Used', formatBytes(mem.heapUsed)],
    ['Heap Total', formatBytes(mem.heapTotal)],
    ['External', formatBytes(mem.external)],
    ['Array Buffers', formatBytes(mem.arrayBuffers)],
  ]);
}

// ---------------------------------------------------------------------------
// Save Results
// ---------------------------------------------------------------------------

async function saveResults(allResults) {
  const resultsDir = new URL('./results', import.meta.url).pathname;
  if (!existsSync(resultsDir)) await mkdir(resultsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = join(resultsDir, `perf-${timestamp}.json`);

  await fsWriteFile(outPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: { iterations: BASE_ITER, concurrent: CONCURRENT_COUNT, quick: isQuick },
    ...allResults,
  }, null, 2) + '\n');

  console.log(`\n  Results saved to: ${outPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let terminalManager, clearSessions;

  try {
    ({ terminalManager, clearSessions } = await setup());

    const allResults = {};

    // Backend API latency
    allResults.apiLatency = await runApiLatencyBenchmarks();

    // Terminal CRUD (heavy — spawns processes)
    allResults.terminalCrud = await runTerminalCrudBenchmarks();

    // Concurrent requests
    allResults.concurrent = await runConcurrentBenchmarks();

    // WebSocket performance
    allResults.websocket = await runWebSocketBenchmarks();

    // Frontend build + serving
    allResults.frontend = await runFrontendBenchmarks();

    // Final memory snapshot
    printMemory();

    // Save JSON results for tracking
    await saveResults(allResults);

    console.log('\n  Done.\n');

  } catch (err) {
    console.error('\n  FATAL:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await teardown(terminalManager, clearSessions);
  }
}

main();
