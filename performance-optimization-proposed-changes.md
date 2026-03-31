## After Phase 4 (proposed by Phase 4 generator)
- The gitignore cache is module-level (singleton Map). If DanCode ever supports hot-reloading server modules, the cache would survive reloads. Not an issue now but worth noting.
- The RingBuffer compaction threshold is 2x maxSize. This balances between compacting too often (defeating the purpose) and accumulating too many chunks. If profiling shows memory issues under extreme throughput, the multiplier could be tuned.

## After Phase 1 (proposed by Phase 1 generator)
- The client build fails due to a missing `ResizeHandle.jsx` import in `App.jsx`. This is a pre-existing issue that blocks `npm run build`. Future phases that need a fresh client build will need to fix this import first.
- The `compression` package handles content-encoding negotiation automatically (gzip/deflate/br based on Accept-Encoding). No additional configuration is needed for brotli support if Node.js is built with it.
- Four server tests fail pre-existing (tmux capture pane output wrapping on small terminal widths, and a missing `lastActivity` field). These are not caused by compression changes.

## After Phase 5 (proposed by Phase 5 generator)
- The MobileDashboard polling and the App.jsx `fetchAllTerminalActivity` interval (line 146) both poll on 30s intervals. Consider consolidating these into a single visibility-aware polling mechanism in App.jsx to avoid duplicate requests when the dashboard is mounted.
- The ETag implementation currently uses `getFileStats` + `readFileContent` as separate calls, meaning two `stat()` calls per read. A combined `readFileContentWithStats` function could reduce this to one stat + one read.
- The `compression` middleware converts strong ETags to weak ETags on compressed responses. This doesn't affect correctness since our `If-None-Match` check runs before `res.json()`, but clients will see `W/"..."` ETags in responses. Future phases should be aware of this if adding ETag support to other endpoints.
