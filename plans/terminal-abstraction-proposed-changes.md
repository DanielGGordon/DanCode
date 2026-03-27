# Terminal Abstraction — Proposed Changes

## After Phase 3 (proposed by Phase 3 generator)
- E2E tests all fail on login due to missing `~/.dancode/e2e-password` file. This is a pre-existing issue from Phase 2. Future phases should either: (a) create a setup script that configures test credentials, or (b) add a test-mode bypass that skips auth for E2E tests running on localhost:3001.
- The drag-and-drop image upload feature injects the file path as raw text into the terminal input. Future phases may want to wrap this in quotes or escape special characters to handle paths with spaces.
- Socket.io reconnection clears the terminal (`term.clear()` + `term.reset()`) before ring buffer replay to avoid duplicate output. If Phase 4 (tmux persistence) changes how buffer replay works, this clear-before-replay logic in Terminal.jsx will need to stay in sync.

## After Phase 7 (proposed by Phase 7 generator)
- The mobile breakpoint in App.jsx uses `<1024px` for the mobile/tablet boundary, while TerminalLayout uses `<768px` for phone vs tablet. If future phases change these breakpoints, both files need to be kept in sync. Consider extracting breakpoints to a shared constants file.
- The `readFirst` prop on Terminal.jsx currently just prevents auto-focus. If future phases add more sophisticated read-first behavior (e.g., preventing cursor blink, hiding input line), the Terminal component will need additional changes.
- Pinch-to-zoom changes font size in-memory only (via `fontSizeRef`). If future phases add font size persistence (saved to project config), the pinch-to-zoom handler will need to call the save API.
- The MobileTerminalView creates its terminal list by fetching `/api/terminals?project=slug` separately from TerminalLayout's load. If future phases add real-time terminal creation/deletion (WebSocket events), both code paths need to handle the same events.
