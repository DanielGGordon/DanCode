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

## After Phase 5 (proposed by Phase 5 generator)

- `TerminalSwiper` always creates `HorizontalPager` with `pageCount =
  terminals.size` and never re-fetches, so terminal-list changes that
  happen *while* the user is inside a terminal (e.g. another client
  opens a new terminal in the same project) won't appear until they
  back out and re-enter. A polling refresh inside the swiper — or
  better, a server-pushed "terminals changed" event — would close that
  gap. Until then, the contract is: the terminal list snapshot is taken
  at the moment of navigation.
- The pager renders every TerminalHost for every page that Compose
  composes. `HorizontalPager` by default also pre-composes neighbours,
  so two adjacent socket connections may be open at once during a
  swipe. For Phase 5 this is fine (the server already supports
  concurrent attach), but on lower-end devices it could double network
  cost. A `beyondViewportPageCount = 0` knob is available — worth
  considering once we have real-device measurements.
- Pinch-to-zoom and the two-finger drag both live on the terminal view
  as separate `pointerInput` blocks. They generally play nicely, but a
  noisy hand might enter "scroll mode" *and* a small pinch on the same
  frame. If we see drift in practice, a single `awaitPointerEvent`
  loop that arbitrates between scroll and zoom would be cleaner than
  two parallel detectors.
- `TerminalHost` falls back to a non-persistent in-memory font size
  when `fontSizeStore` is null. The constructor in `MainActivity`
  always passes one, but the parameter is `null`-able so test
  composables don't need to wire it. If a later phase wants different
  font-size policies (e.g. per-project override), an interface for the
  store (`FontSizeStore { read/save/reset/step }`) might cleanly slot
  in there — but YAGNI for now.
- `MainActivity.AppNav` reads `controller.state.value` directly in a
  few places (for the terminal-list selection) instead of via
  `collectAsState`. That's safe in the current code path but is the
  kind of thing that breaks when a controller switches to async loads.
  Worth tightening if we ever see "stale list" complaints.
- The Robolectric configuration-change test asserts `configChanges`
  flags from the manifest, but doesn't actually fire
  `Activity.onConfigurationChanged` through Robolectric (the activity
  controller plumbing for that is fiddly and the value-add of the
  assertion is small). If a future regression sneaks a `recreate()`
  back in, this test won't catch it. A heavier integration test that
  builds the activity, rotates via `RuntimeEnvironment.setQualifiers`,
  and checks the same Compose tree survives would close that gap.
