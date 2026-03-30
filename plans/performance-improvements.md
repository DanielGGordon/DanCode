# Performance Improvement Opportunities

Identified through codebase analysis of DanCode (Express + React on Raspberry Pi 5).

---

## Server-Side

### 1. Add gzip/brotli compression middleware

**Current state:** No compression middleware. Every response (JSON, HTML, JS, CSS) is sent uncompressed.

**Impact:** High — especially for serving the frontend bundle over Tailscale. JS bundles compress 60-70% with gzip. API JSON responses compress well too.

**Implementation:**
```bash
npm install compression -w server
```
```js
import compression from 'compression';
app.use(compression());
```

**Risk:** Low. Drop-in middleware. ~2 lines of code.

---

### 2. Add Cache-Control headers for static assets

**Current state:** `express.static(clientDistPath)` serves assets with no cache headers. Browsers re-fetch every time.

**Impact:** High for repeat visits — Vite-built assets have content hashes in filenames (immutable), so they can be cached aggressively.

**Implementation:**
```js
app.use(express.static(clientDistPath, {
  maxAge: '1y',           // hashed assets are immutable
  immutable: true,
}));
// Serve index.html with no-cache so app updates take effect
```

**Risk:** Low. Standard practice for hash-named bundles.

---

### 3. Session validation is O(1) but sessions persist unboundedly

**Current state:** Sessions are stored in a `Map` and persisted to `sessions.json`. There's no expiry or cleanup. Over time, the sessions file grows.

**Impact:** Low right now (single user), but the file I/O for `saveSessions()` on every login/logout writes the entire Map to disk.

**Implementation:** Add TTL-based expiry (e.g., 30 days). Clean expired sessions on startup and periodically.

**Risk:** Low.

---

### 4. File listing does synchronous gitignore parsing per request

**Current state:** `listDirectory()` in `files.js` creates a new `ignore()` instance and reads `.gitignore` files on every API call.

**Impact:** Medium for directories with many `.gitignore` files or deep nesting. Each directory listing re-parses gitignore rules.

**Implementation:** Cache the `ignore()` instance per project root. Invalidate on file change (or use a short TTL).

**Risk:** Low-medium. Need to handle gitignore file changes.

---

### 5. Terminal ring buffer uses string concatenation + slice

**Current state:** `RingBuffer.append()` does `this.data += chunk` then slices if over limit. String concatenation creates garbage for GC.

**Impact:** Low-medium. Under heavy terminal output (e.g., `cat` of a large file), this creates significant GC pressure.

**Implementation:** Use a circular `Buffer` or array of chunks with a byte counter. Only concatenate on `getContents()`.

**Risk:** Low. Internal implementation change, same API.

---

### 6. `saveSessions()` uses synchronous `writeFileSync`

**Current state:** Every `createSession()` and `destroySession()` call triggers a synchronous file write. This blocks the event loop.

**Impact:** Low for single-user usage. Could become noticeable under concurrent logins.

**Implementation:** Switch to async `writeFile` with debouncing (batch writes within a 100ms window).

**Risk:** Low. Minor chance of data loss on crash (acceptable for sessions).

---

## Client-Side

### 7. No code splitting — single JS bundle

**Current state:** Vite builds everything into one JS chunk. The entire app loads on the login page, even though most components aren't needed until after auth.

**Impact:** Medium-high on initial load, especially on mobile over Tailscale. Login screen loads the full xterm.js, highlight.js (18 languages), file explorer, etc.

**Implementation:** Use React.lazy + Suspense for:
- `TerminalLayout` (only after auth)
- `FileExplorer` / `FileViewer` (only when opened)
- `MobileDashboard` / `MobileTerminalView` (only on mobile)

**Risk:** Low. Standard React pattern.

---

### 8. highlight.js imports all 18 languages unconditionally

**Current state:** `FileViewer.jsx` imports highlight.js with 18 language definitions at bundle time (~200KB+ of highlight rules).

**Impact:** Medium. These are loaded even if the user never opens a file viewer.

**Implementation:** Dynamically import `highlight.js` and only register languages when `FileViewer` mounts.

**Risk:** Low. Small async delay on first file view.

---

### 9. xterm.js loaded eagerly for all terminals

**Current state:** The Terminal component imports xterm.js at the top level. Every terminal pane loads the full xterm library.

**Impact:** Low-medium. xterm.js is ~250KB. It's shared across terminals (single module instance), but adds to initial parse time.

**Implementation:** Dynamic import on first terminal render.

**Risk:** Low. Brief flash before terminal appears.

---

### 10. No service worker precaching of API responses

**Current state:** Service worker caches the app shell (HTML, JS, CSS) but not API responses. Project list, terminal metadata, etc. are always network-fetched.

**Impact:** Low. API calls are fast on LAN. But could improve perceived performance for project switching.

**Implementation:** Cache GET `/api/projects` with a stale-while-revalidate strategy.

**Risk:** Medium. Need to handle cache invalidation when projects are created/deleted.

---

### 11. Mobile dashboard polls every 30 seconds

**Current state:** `MobileDashboard` fetches project list on a 30-second interval for activity indicators.

**Impact:** Low. But on battery-constrained mobile, unnecessary network activity.

**Implementation:** Use `document.visibilityState` to pause polling when the tab is hidden. Consider WebSocket push for activity updates instead of polling.

**Risk:** Low.

---

## Infrastructure / Deployment

### 12. No HTTP/2

**Current state:** Express serves over HTTP/1.1. Each asset requires a separate TCP connection (or waits for pipelining).

**Impact:** Medium for initial page load with multiple assets. HTTP/2 multiplexes all requests over one connection.

**Implementation:** Use a reverse proxy (nginx, caddy) in front of Express, or switch to `node:http2`.

**Risk:** Medium. Requires TLS certificate setup (HTTP/2 requires HTTPS in browsers).

---

### 13. No ETag support for API responses

**Current state:** API responses don't include ETag or Last-Modified headers. Clients can't do conditional requests.

**Impact:** Low. Most API calls return small JSON. But file content responses could benefit from conditional GETs.

**Implementation:** Express has built-in ETag support via `app.set('etag', true)` (actually enabled by default for `res.send`, but not for `res.json` in all cases). For file content, compute ETag from file mtime/size.

**Risk:** Low.

---

## Priority Ranking

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | Compression middleware (#1) | 5 min | High |
| 2 | Static asset caching (#2) | 10 min | High |
| 3 | Code splitting (#7) | 1-2 hr | Medium-high |
| 4 | Lazy highlight.js (#8) | 30 min | Medium |
| 5 | Gitignore caching (#4) | 30 min | Medium |
| 6 | HTTP/2 via reverse proxy (#12) | 1 hr | Medium |
| 7 | Ring buffer optimization (#5) | 30 min | Low-medium |
| 8 | Async session persistence (#6) | 20 min | Low |
| 9 | Session TTL (#3) | 20 min | Low |
| 10 | Dynamic xterm import (#9) | 20 min | Low-medium |
| 11 | SW API caching (#10) | 1 hr | Low |
| 12 | Visibility-aware polling (#11) | 15 min | Low |
| 13 | ETag for file API (#13) | 30 min | Low |
