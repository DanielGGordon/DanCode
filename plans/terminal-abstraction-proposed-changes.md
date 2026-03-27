# Terminal Abstraction — Proposed Changes

## After Phase 3 (proposed by Phase 3 generator)
- E2E tests all fail on login due to missing `~/.dancode/e2e-password` file. This is a pre-existing issue from Phase 2. Future phases should either: (a) create a setup script that configures test credentials, or (b) add a test-mode bypass that skips auth for E2E tests running on localhost:3001.
- The drag-and-drop image upload feature injects the file path as raw text into the terminal input. Future phases may want to wrap this in quotes or escape special characters to handle paths with spaces.
- Socket.io reconnection clears the terminal (`term.clear()` + `term.reset()`) before ring buffer replay to avoid duplicate output. If Phase 4 (tmux persistence) changes how buffer replay works, this clear-before-replay logic in Terminal.jsx will need to stay in sync.
