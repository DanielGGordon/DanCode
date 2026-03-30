# Plan: DanCode Performance Optimization

> Source: plans/performance-improvements.md

## Project config

- **Tech stack**: Express 5 + React 19 + Vite 8 (existing stack, no new frameworks)
- **Eval approach**: Run `npm run test:perf:quick` and compare results against baseline in `perf/baseline.json`. All existing tests must also pass (`npm test`).
- **AI surface**: N/A — performance optimization of existing app, no new user-facing AI features needed. The existing Claude terminal integration serves as the AI modification surface.

## Architectural decisions

- **Compression**: Use the `compression` npm package as Express middleware (de facto standard, handles gzip/deflate/brotli negotiation)
- **Caching strategy**: Hashed Vite assets get `Cache-Control: max-age=31536000, immutable`; `index.html` and `sw.js` get `no-cache` so updates propagate immediately
- **Code splitting boundary**: Auth gate is the split point — login screen is one chunk, post-auth app (terminals, file explorer, mobile views) lazy-loads
- **Heavy dependency loading**: highlight.js languages and xterm.js load dynamically on first use, not at bundle time
- **Session TTL**: 30-day expiry, cleaned on server startup and hourly thereafter
- **Gitignore caching**: Per-project-root ignore instance with 30-second TTL
- **Ring buffer**: Array-of-chunks with byte counter; concatenate only on `getContents()`
- **ETag scope**: File read API only (`GET /api/files/read`) — compute from file mtime + size

## Performance baseline

See `perf/baseline.json` for the full baseline snapshot taken before any optimization work. Key metrics to track:

| Metric | Baseline Value |
|--------|---------------|
| Total JS bundle (gzip) | 718.8KB (198.3KB gzip) |
| Total CSS bundle (gzip) | 29.3KB (6.2KB gzip) |
| GET /projects mean latency | 9.10ms |
| GET /files/read mean latency | 9.24ms |
| Concurrent throughput (20 parallel) | 163 req/s |
| WS echo round-trip mean | 8.20ms |
| JS bundle serve mean | 15.14ms |
| Server startup time | 915ms |

**How to evaluate**: Run `npm run test:perf:quick` after each phase. Compare the JSON output in `perf/results/` against `perf/baseline.json`. Key assertions:
- No API latency regression > 20% vs baseline mean
- Bundle size reductions in phases that touch the client
- Transfer size reductions in phases that add compression
- All existing tests pass: `npm test`

---

<!-- PARALLEL 1,2 -->

## Phase 1: Server Response Optimization

**Delivers**: Gzip compression on all HTTP responses and aggressive Cache-Control headers on Vite-hashed static assets. Browsers get ~60-70% smaller transfers for JS/CSS/JSON, and repeat visits serve hashed assets from disk cache.

**Acceptance criteria**:
- `compression` package is installed as a server dependency and applied as Express middleware before all routes
- Responses to `GET /api/projects` include `Content-Encoding: gzip` (or `br`) header when client sends `Accept-Encoding: gzip`
- Static assets served from `client/dist/assets/` have `Cache-Control: public, max-age=31536000, immutable`
- `index.html` is served with `Cache-Control: no-cache` so app updates take effect immediately
- `sw.js` retains its existing `no-cache, no-store, must-revalidate` header
- All existing server tests pass (`npm test -w server`)
- `npm run test:perf:quick` runs without errors and shows no API latency regression > 20% vs baseline

---

## Phase 2: Client Code Splitting & Lazy Dependencies

**Delivers**: The login page loads a small initial chunk. Post-auth components (TerminalLayout, FileExplorer, FileViewer, MobileDashboard, MobileTerminalList, MobileTerminalView) load via React.lazy + Suspense. highlight.js languages and xterm.js are dynamically imported on first use, not at bundle time.

**Acceptance criteria**:
- `npm run build -w client` produces 3 or more JS chunks (verify with `ls client/dist/assets/*.js | wc -l`)
- The largest JS chunk is smaller than the baseline single-chunk size (check against `perf/baseline.json` jsBundle size)
- Post-auth components use `React.lazy()` with `<Suspense>` fallbacks
- highlight.js core + language registrations are dynamically imported inside FileViewer (not top-level static imports)
- xterm.js is dynamically imported inside the Terminal component (not a top-level static import)
- All existing client tests pass (`npm test -w client`)
- `npm run test:perf:quick` runs without errors; frontend build analysis shows multiple JS chunks

---

## Phase 3: Session Management Hardening

**Delivers**: Sessions expire after 30 days. Expired sessions are cleaned on server startup and periodically (hourly). `saveSessions()` uses async `writeFile` with debouncing (100ms window) instead of synchronous `writeFileSync`, unblocking the event loop.

**Acceptance criteria**:
- Sessions stored with a `createdAt` timestamp (already present) are checked against a 30-day TTL on validation
- `validateSession()` returns false for sessions older than 30 days
- Server startup cleans expired sessions from the in-memory Map and persists the cleanup
- `saveSessions()` uses `fs.promises.writeFile` (async), not `writeFileSync`
- Multiple rapid `createSession()` calls batch into a single disk write (debounce window)
- All existing auth tests pass (`npm test -w server`)
- `npm run test:perf:quick` shows no regression in `POST /auth/validate` latency vs baseline

---

<!-- PARALLEL 4,5 -->

## Phase 4: Server I/O Optimization

**Delivers**: Gitignore rules are cached per project root with a 30-second TTL, eliminating redundant `.gitignore` file reads and `ignore()` instance creation on repeated directory listings. The terminal ring buffer uses an array-of-chunks internally instead of string concatenation + slice, reducing GC pressure under heavy terminal output.

**Acceptance criteria**:
- Repeated `GET /api/files?project=...&path=.` calls reuse a cached ignore instance (no `.gitignore` re-read within the TTL window)
- The gitignore cache invalidates after 30 seconds (a new listing after TTL re-reads `.gitignore`)
- `RingBuffer` internally stores chunks in an array, only concatenating in `getContents()`
- `RingBuffer.append()` does not use string `+=` concatenation
- All existing file and terminal tests pass (`npm test -w server`)
- `npm run test:perf:quick` shows no regression in `GET /files (list dir)` or `GET /files/read` latency vs baseline

---

## Phase 5: Client Runtime & ETag Optimization

**Delivers**: Mobile dashboard polling pauses when the browser tab is hidden (using `document.visibilityState`), saving battery on mobile devices. The file read API returns ETag headers computed from file mtime + size, and conditional `GET` requests with `If-None-Match` receive `304 Not Modified`.

**Acceptance criteria**:
- MobileDashboard registers a `visibilitychange` event listener that pauses/resumes the polling interval
- When `document.visibilityState === 'hidden'`, no fetch calls are made to `/api/projects`
- `GET /api/files/read` responses include an `ETag` header
- A subsequent `GET /api/files/read` with `If-None-Match` matching the ETag returns `304` with no body
- A `GET /api/files/read` after the file is modified returns `200` with a new ETag
- All existing tests pass (`npm test`)
- `npm run test:perf:quick` shows no regression vs baseline
