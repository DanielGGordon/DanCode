# Learnings
# Ralph appends entries after each phase.

## [2026-05-15 22:46] Phase 1: Shellhost MVP + web wiring

Playwright starts every `webServer` entry BEFORE running `globalSetup`, so spawning a UNIX-socket dependency in globalSetup can't satisfy a server that polls for it during webServer boot — the fix is to spawn the dependency inside the webServer entry's process (a small wrapper script that boots the child and then loads the server inline). Isolating shellhost-backed E2E behind a per-run temp `HOME` is much simpler than threading data-dir env vars through auth/projects/terminal modules, and keeps real `~/.dancode` credentials out of the test path. Port 3002 is grabbed by Tailscale's `serve` on the dev Pi; check `tailscale serve status` before picking E2E ports. The legacy `TerminalManager._publicMeta` (added by Phase 4) silently dropped `lastActivity` and broke the existing creation-time assertion — small alignment with `get()`/`list()` is the right fix until Phase 3/9 rewrites that path. Phase 1 also exposes a server-side ring buffer that duplicates Phase 2's planned disk-backed scrollback — drop it when Phase 2 lands.
