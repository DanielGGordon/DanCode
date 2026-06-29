# Android Adoption — Proposed Changes (post-phase notes)

Generators leave notes here for future phases when they discover something
worth changing in the plan or in code they didn't own.

## After Phase 4 (proposed by Phase 4 generator)

- The two-finger drag routing in `TerminalHost.kt` uses a hard-coded
  `cellPx = 32f` as the gesture-to-row divisor. The renderer's actual
  font line spacing is reachable via `TerminalView.mRenderer.fontLineSpacing`,
  but Compose `pointerInput` runs outside the AndroidView's update
  callback so it can't trivially see the renderer instance. A small
  follow-up: stash the line height in a `MutableState<Float>` updated
  from `AndroidView.update`, read it inside `pointerInput`. Without
  this the SGR wheel-step is approximate (still works, just at coarser
  resolution than ideal).
- `InputModePolicy` lives in `TerminalHost` as a `remember { InputModePolicy() }`
  AND a separate `manualOverride` Compose state, then re-syncs the
  override into the policy each composition. It works but feels
  layered. A simpler refactor would be to make the policy itself a
  Compose `mutableStateOf`-backed object, or split the auto-detect
  function and the override entirely. Worth revisiting if a future
  phase needs to read/write the override from another screen.
- The Phase 4 raw-mode mode-switch is driven by a 60Hz `LaunchedEffect`
  poll of `emulator.isAlternateBufferActive` and `emulator.isMouseTrackingActive`.
  The Termux `TerminalSessionClient` interface doesn't expose a "DECSET
  changed" callback. If we ever care about battery on this poll, a
  callback-driven version would need a small patch to the vendored
  `TerminalEmulator.java` (signal an observer when 1049/1000/1006 flip).
  Carry as a separate patch file so the next Termux sync stays cheap.
- `ScrollRouter` always emits `LocalScroll(delta)` for non-raw drags,
  but `TerminalView` already handles single-finger scroll via its own
  GestureRecognizer. The `pointerInput` wrapper in `TerminalHost`
  currently does *not* consume the events on the local-scroll path, so
  the underlying view's recogniser drives the scroll for two-finger as
  well. If a future phase wants explicit control over local scroll
  velocity, the wrapper would need to call into `TerminalView`'s
  `mTopRow` directly — that's a bigger surgery.
- The control key bar puts `Ctrl+C` between `Enter` and `Tab` in the
  enum order. If we want a different visual order without changing
  the byte-sequence assertions, expose a separate `displayOrder: Int`
  field on `ControlKey` or change the iteration order in `KeyBar`.
