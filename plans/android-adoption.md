# Plan: DanCode-Android (native client)

> Source: Grilling session 2026-06-29 (locked decision table in conversation). Replaces the mobile web client, which scrolls/types poorly on Android.

## Project config

- **Tech stack**: Native Android — Kotlin + Jetpack Compose (`minSdk 30`, target current SDK). Multi-module Gradle build under `android/`: `:app` (Compose UI + networking), plus vendored `:terminal-emulator` and `:terminal-view` (Termux source, GPLv3, not distributed). Transport via `io.socket:socket.io-client`. Build + host on one Hetzner box (`5.78.231.51`); toolchain (JDK 17 + Android cmdline-tools) installed **project-local**, never touching the system Java 8 / Node setup.
- **Eval approach**: Fully headless `android/gradlew test` — no emulator, no device. Two test families: (1) **JVM golden tests** that feed recorded ANSI/VT byte streams into the vendored emulator and assert screen-buffer snapshots; (2) **Robolectric** tests for Compose interaction + networking logic (sockets/HTTP behind interfaces with fakes). An optional emulator screenshot smoke suite may exist but is **never** part of the gated evaluator run. Manual on-device acceptance (sideload over the phone browser) is documented per phase but is not the automated contract.
- **AI surface**: This app *is* an AI surface — its reason to exist is driving **Claude Code** (an agentic CLI) against the user's repos from a phone. Self-modification is achieved by opening a Claude terminal on the DanCode repo itself (the `android/` tree included), so the app can be iterated on by pointing Claude at it from within the app. No separate chat panel is added; the terminal-to-Claude path is the modification surface, and Phase 4 makes it first-class.

## Architectural decisions

- **Repo layout**: `android/` at the monorepo root. Gradle settings register `:app`, `:terminal-emulator`, `:terminal-view`. Application id `com.dancode.android`.
- **Backend contract (unchanged — zero server code change except the TLS terminator)**:
  - REST (Bearer token): `POST /api/auth/login` `{username,password,totpCode}` → `{token}` (30-day); `GET /api/projects`; `GET /api/terminals?project=<slug>`.
  - Socket.io per-terminal namespace `/terminal/<uuid>`, handshake `auth:{token}`, `transports:['websocket']`. Client events `input` (string) and `resize` `{cols,rows}`; server events `output` (string) and `exit`. On connect the server replays a ~50KB ring buffer — the client must clear+reset on *re*connect to avoid duplicate replay.
- **Auth/session**: token stored in `EncryptedSharedPreferences`; injected as `Authorization: Bearer` on REST and `auth.token` on the socket handshake. Server base URL is user-configurable, defaulting to the new HTTPS endpoint. A `401` (expired/invalid) routes the user back to login.
- **TLS**: a committed reverse-proxy config (Caddy or nginx) terminates TLS on a **new** HTTPS port using a self-signed cert for the IP `5.78.231.51`. The existing plain `http://5.78.231.51:3000` web path is left untouched so the web client keeps working. The app pins that exact self-signed cert via `network-security-config` and rejects any other cert for the host — encryption without a domain (avoids Techloq filtering a new hostname).
- **Input model (state machine)**: two modes. *Cooked* (default) = a line-buffered Compose text field; pressing Send emits the typed line followed by `\r`. *Raw* = each keystroke is sent immediately as its byte sequence. Raw **auto-engages** whenever the emulator reports the alternate screen buffer (DECSET 1049) or mouse-tracking is active, and reverts on exit. A manual override toggle is always available.
- **Scroll model**: when the emulator is in the alternate screen / mouse-tracking state, a two-finger vertical drag emits SGR (1006) mouse-wheel sequences (`ESC [ <64 ; x ; y M` up / `<65` down) so TUIs like Claude scroll their own viewport; otherwise the drag scrolls the local scrollback buffer. Mirrors the proven web-client logic.
- **Scope**: terminal-first. Navigation is three levels — **dashboard** (project list) → **terminal list** (per project) → **full-screen terminal**. Deferred entirely: file explorer, CodeMirror editor, image upload, clipboard paste, Resume-Claude button, `claudeActive` dashboard indicators.
- **Toolchain isolation**: a committed bootstrap script installs JDK 17 and Android cmdline-tools under `android/.toolchain/` (or equivalent project-local dirs), wires them via `local.properties` / `JAVA_HOME` scoped to the Gradle invocation, accepts SDK licenses non-interactively, and leaves the system `java` (1.8) and Node untouched.
- **Worktree convention (Ralph)**: Phase 0 creates the long-lived integration branch `android/integration` from `master`. **Every** subsequent phase runs entirely inside its own git worktree and merges back on green:
  - Setup: `git worktree add .claude/worktrees/android-phase-<N> -b android/phase-<N> android/integration`
  - Do all work inside `.claude/worktrees/android-phase-<N>/`.
  - On all acceptance criteria passing: `git -C .claude/worktrees/android-phase-<N> commit -am "phase <N>"`, then from the main checkout `git checkout android/integration && git merge --no-ff android/phase-<N>`.
  - Teardown: `git worktree remove .claude/worktrees/android-phase-<N>`.
  - Parallel phases each branch from `android/integration` independently. If two parallel phases both edit `android/settings.gradle.kts`, the merge resolves by unioning the module list (additive only).

## System tools & dependencies

Everything the **gated** evaluator run (`android/gradlew test`) touches, labeled by cadence. The gated run uses **no emulator, no physical device, and no network/cloud services** — all networking in tests is behind interfaces backed by in-memory fakes.

| Tool / dependency | Cadence | Purpose |
|---|---|---|
| JDK 17 (project-local under `android/.toolchain/`) | One-time setup (bootstrap script) | Compiles/runs Gradle + Kotlin; never replaces system Java 8 |
| Android cmdline-tools + platform/build-tools (project-local SDK dir) | One-time setup (bootstrap script, licenses auto-accepted) | Android build + Robolectric runtime |
| `android/gradlew` (Gradle wrapper, committed) | Every run | Drives `assembleDebug` and `test` |
| Robolectric + JUnit + Compose test deps (Gradle-resolved) | Every run (cached after first resolve) | Headless Compose interaction + JVM unit tests |
| Vendored `:terminal-emulator` golden-test fixtures (committed recorded byte streams + snapshots) | Every run | Screen-buffer assertions; no external input needed |
| Self-signed cert for `5.78.231.51` + Caddy/nginx reverse-proxy config (committed) | One-time setup (stand up on the box) | **Runtime/manual** path only — the app's pinned-TLS connection. **Not** required for the gated `test` run |
| Android emulator | Optional, never gated | Only for the manual screenshot smoke suite |

## Initial Setup (Human Required)

These are one-time human actions, performed once on the Hetzner box (or once per credential). **None of them recur**, and — to be explicit — a normal gated `android/gradlew test` run requires **zero human intervention** (no device, no login, no live backend).

- **Run the toolchain bootstrap script** (once, on the Hetzner box) — provisions project-local JDK 17 + Android SDK and accepts SDK licenses. Performed by the developer/agent once; subsequent runs reuse it.
- **Generate the self-signed cert + stand up the TLS reverse proxy** (once) — create the cert for `5.78.231.51`, install the Caddy/nginx config, start it on the new HTTPS port. Performed by the developer/agent once. Needed only for manual on-device use, not for gated tests.
- **Supply login credentials / TOTP** (per manual session) — entering username/password/TOTP on the phone is a manual-acceptance action only; it never appears in the automated test path.

## Deployment

The Hetzner box is both build host and backend, so "deploy" = publish a new APK and the manual smoke that follows.

- **Build & publish**: `android/gradlew :app:assembleDebug` produces the debug-signed APK (debug signing is fine — personal, unpublished). A make/CI step copies it to the path served by the APK download route on the existing origin so the phone browser can fetch it over the pinned-TLS endpoint.
- **Distribute (sideload)**: on the phone, open the download route in the browser, download the APK, and install it (one tap; the app is debug-signed and installed from "unknown sources").
- **Post-deploy verification**: a documented smoke check confirms the new build installs and launches, completes TOTP login against the live backend over HTTPS with the **pinned** cert (a cert mismatch must fail closed), and opens one live terminal that echoes `ls`. From Phase 4 on, the smoke also drives a short Claude exchange.
- **Rollback**: keep the previous APK artifact alongside the current one under the download route (e.g. a `previous` link); reverting is re-sideloading the prior APK. On the code side, a bad build is reverted by resetting `android/integration` to the last green merge (`git reset --hard <prev-merge>`), since every phase merges as a discrete `--no-ff` commit.

---

## Phase 0: Toolchain & Compose skeleton
<!-- PHASE 0 COMPLETE -->

**Worktree**: First create the integration branch — `git branch android/integration master` — then `git worktree add .claude/worktrees/android-phase-0 -b android/phase-0 android/integration`. All Phase 0 work happens in that worktree; merge into `android/integration` on green and `git worktree remove` it.

**Delivers**: A project-local Android toolchain (JDK 17 + Android SDK) bootstrapped on the Hetzner box without disturbing system Java 8/Node, plus a minimal Compose app under `android/` that builds to an APK and runs a headless test. Proves the entire agent-driven build/test loop before any feature work.

**Acceptance criteria**:
- A committed bootstrap script provisions JDK 17 + Android cmdline-tools into project-local directories and accepts SDK licenses non-interactively; after running it, `java -version` invoked outside the project still reports 1.8 (system Java untouched).
- `android/gradlew :app:assembleDebug` produces a debug-signed APK artifact, run headless with no emulator/device.
- `android/gradlew test` executes at least one trivial unit test and exits 0, headless.
- A Robolectric test renders the root composable (a placeholder screen) and asserts a known element is present.
- The build declares `minSdk 30`, the current target SDK, and application id `com.dancode.android`.

**AI opportunity**: Document in the repo how to open a Claude terminal on `android/` so the app's own code is modifiable via Claude Code — establishes the self-modification surface early.

---

<!-- PARALLEL 1,2 -->

## Phase 1: Vendor & golden-test the terminal core
<!-- PHASE 1 COMPLETE -->

**Worktree**: `git worktree add .claude/worktrees/android-phase-1 -b android/phase-1 android/integration`. Work there; merge to `android/integration` on green; `git worktree remove`. Runs in parallel with Phase 2 (disjoint modules; only `settings.gradle.kts` overlaps, additively).

**Delivers**: The Termux `terminal-emulator` and `terminal-view` libraries vendored as in-tree Gradle modules, with a golden-test suite that exercises the pure-JVM emulator against recorded terminal sessions. This front-loads the riskiest correctness work into the fully headless-testable layer, with no UI yet.

**Acceptance criteria**:
- `:terminal-emulator` and `:terminal-view` exist as Gradle modules built from vendored Termux source, and `:app` depends on them; the whole tree compiles via `android/gradlew :app:assembleDebug`.
- A golden-test suite feeds at least three recorded byte streams — a captured Claude Code alt-screen session, a `vim`/full-screen TUI session, and colored plain-shell output — into the emulator and asserts the resulting screen-buffer cells (text content + key attributes such as color/bold/inverse) match committed snapshot fixtures.
- The emulator exposes a queryable state for "alternate screen buffer active" and "mouse-tracking active", and tests assert correct enter/exit transitions driven by DECSET/DECRST 1049 and mouse-mode sequences within the recorded streams.
- All terminal-core tests run under `android/gradlew test`, headless, with no device or emulator.

---

## Phase 2: TLS terminator + login + project dashboard
<!-- PHASE 2 COMPLETE -->

**Worktree**: `git worktree add .claude/worktrees/android-phase-2 -b android/phase-2 android/integration`. Work there; merge to `android/integration` on green; `git worktree remove`. Runs in parallel with Phase 1.

**Delivers**: An encrypted, cert-pinned path from the app to the existing backend, a working TOTP login that persists a 30-day token, and a dashboard listing the user's projects. Also an APK download route so new builds can be sideloaded from the phone browser.

**Acceptance criteria**:
- A committed reverse-proxy config terminates TLS on a new HTTPS port with a self-signed cert for `5.78.231.51`, proxying to the existing backend; the original `http://5.78.231.51:3000` path remains functional (the web client is unaffected).
- The app's `network-security-config` pins that self-signed cert for the host and rejects any other certificate; a test asserts the pinning configuration is present and scoped to the host.
- A login flow accepts a configurable server base URL (defaulting to the HTTPS endpoint) plus username/password/TOTP, posts to `POST /api/auth/login`, and persists the returned token in `EncryptedSharedPreferences`.
- After authentication the app calls `GET /api/projects` with the Bearer token and renders a dashboard list of project names; a `401` response routes back to the login screen.
- An APK download route on the same origin serves the latest built APK for browser sideload.
- Robolectric/JVM tests (against a fake/mock server) cover: token persist+retrieve, Bearer-header injection, dashboard rendering from a mocked projects payload, and 401→login routing — all headless.

---

## Phase 3: One live terminal end-to-end
<!-- PHASE 3 COMPLETE -->

**Worktree**: `git worktree add .claude/worktrees/android-phase-3 -b android/phase-3 android/integration`. Work there; merge to `android/integration` on green; `git worktree remove`. Depends on Phases 1 and 2 (needs the vendored terminal core *and* an authenticated connection), so it starts after both merge.

**Delivers**: Tapping a project shows its terminals; tapping a terminal opens a full-screen view that streams live PTY output into the vendored TerminalView and accepts line-buffered input. Reconnection is handled gracefully. This is the first daily-usable slice for plain shells.

**Acceptance criteria**:
- Selecting a project lists its terminals via `GET /api/terminals?project=<slug>`; selecting one opens a full-screen terminal screen.
- A Socket.io connection to `/terminal/<uuid>` with `auth:{token}` over the pinned-TLS endpoint streams `output` into the TerminalView; on a *re*connect the view is cleared+reset before replay so the ring buffer does not duplicate.
- The cooked-mode Compose input field sends the typed line followed by `\r` as an `input` event; a `resize` `{cols,rows}` is emitted on attach and whenever the view size changes (rotation, keyboard show/hide), with cols/rows derived from view metrics and font size.
- Disconnect surfaces a "reconnecting" overlay and the client auto-reconnects, restoring the live stream.
- JVM/Robolectric tests (socket + HTTP behind interfaces with fakes) cover: line+`\r` input encoding, cols/rows computation from view metrics, the connection-state machine, and reconnect replay-dedup — all headless.
- Manual (documented, not gated): sideload, log in, open a shell terminal, run `ls`, drop the connection, and confirm clean reconnection.

---

## Phase 4: Claude Code works (key bar, raw mode, TUI scroll)
<!-- PHASE 4 COMPLETE -->

**Worktree**: `git worktree add .claude/worktrees/android-phase-4 -b android/phase-4 android/integration`. Work there; merge to `android/integration` on green; `git worktree remove`. Depends on Phase 3.

**Delivers**: The headline capability — a full Claude Code session is usable on the phone. A control key bar covers Claude's interactive keys, input auto-switches to raw passthrough inside the alt-screen, and two-finger scrolling drives Claude's own viewport. Resuming a session started on the web client works.

**Acceptance criteria**:
- A control key bar emits correct byte sequences for Esc, Up/Down/Left/Right arrows, Enter, Ctrl+C, Tab, and Shift+Tab.
- Input mode auto-switches to raw per-keystroke passthrough when the emulator reports alternate-screen/mouse-tracking and reverts to cooked line-buffer on exit; a manual override toggle is present and wins over auto-detection until reset.
- While in the alternate screen, a two-finger vertical drag emits SGR (1006) mouse-wheel sequences; outside it, the same gesture scrolls the local scrollback buffer.
- Golden/unit tests assert: each key-bar byte sequence, the alt-screen→raw-mode transition driven from a recorded Claude stream, SGR wheel-sequence encoding, and the scroll-routing decision (SGR vs local) keyed on emulator state — all headless.
- Manual (documented, not gated): drive a complete Claude Code session on the phone — prompt, watch streaming output, interrupt with Esc, navigate an arrow-key menu — and resume a session originally started in the web client (verifying the shellhost-backed session reflows on attach).

---

## Phase 5: Navigation & polish
<!-- PHASE 5 COMPLETE -->

**Worktree**: `git worktree add .claude/worktrees/android-phase-5 -b android/phase-5 android/integration`. Work there; merge to `android/integration` on green; `git worktree remove`. Depends on Phase 4.

**Delivers**: The full three-level navigation with inter-terminal swiping, font sizing, robust handling of rotation/keyboard resize, and clean recovery from token expiry or server-unreachable conditions — turning the working slices into a smooth daily driver.

**Acceptance criteria**:
- Three-level navigation (dashboard → terminal list → terminal) with a back affordance at each level; swiping left/right cycles between a project's terminals.
- Terminal font size is adjustable (pinch and/or buttons) and persisted per terminal id across app restarts.
- Device rotation and soft-keyboard show/hide re-fit the terminal and emit an accurate `resize` with no rendering corruption.
- Token expiry routes to re-login preserving the intended destination; a server-unreachable state shows a clear, retryable error rather than a hang.
- Robolectric tests cover navigation transitions, font-size persistence, resize-on-configuration-change, and expiry→login routing — all headless.

---

## Deferred (post-MVP, not in this plan)

File explorer, CodeMirror editor, image upload, clipboard image paste, the Resume-Claude button (despite the backend already recording `claudeSessionId`), and live `claudeActive` indicators on the dashboard. Revisit only after the terminal-first MVP is a reliable daily driver.
