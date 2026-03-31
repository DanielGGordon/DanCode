## After Phase 4 (proposed by Phase 4 generator)
- The gitignore cache is module-level (singleton Map). If DanCode ever supports hot-reloading server modules, the cache would survive reloads. Not an issue now but worth noting.
- The RingBuffer compaction threshold is 2x maxSize. This balances between compacting too often (defeating the purpose) and accumulating too many chunks. If profiling shows memory issues under extreme throughput, the multiplier could be tuned.

## After Phase 1 (proposed by Phase 1 generator)
- The client build fails due to a missing `ResizeHandle.jsx` import in `App.jsx`. This is a pre-existing issue that blocks `npm run build`. Future phases that need a fresh client build will need to fix this import first.
- The `compression` package handles content-encoding negotiation automatically (gzip/deflate/br based on Accept-Encoding). No additional configuration is needed for brotli support if Node.js is built with it.
- Four server tests fail pre-existing (tmux capture pane output wrapping on small terminal widths, and a missing `lastActivity` field). These are not caused by compression changes.
