// jsdom polyfills for libraries that touch layout APIs.
//
// CodeMirror 6 calls `document.createRange().getClientRects()` to measure
// text geometry; jsdom does not implement these methods on Range, which
// raises an unhandled error in the requestAnimationFrame callback. Stub
// the missing methods so the editor mounts cleanly under tests. The values
// returned don't matter for the behaviour we assert — we test document
// state and DOM events, not layout/scroll/coordinates.

// Node 22's experimental built-in `localStorage` clobbers jsdom's working
// implementation but requires `--localstorage-file`. Install a small in-memory
// shim so every test sees a clean, functional Storage API regardless of which
// localStorage wins on the host.
{
  const memoryStorage = (() => {
    let store = new Map()
    const api = {
      get length() { return store.size },
      key(i) { return Array.from(store.keys())[i] ?? null },
      getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null },
      setItem(k, v) { store.set(String(k), String(v)) },
      removeItem(k) { store.delete(String(k)) },
      clear() { store.clear() },
    }
    return api
  })()
  try {
    Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true, writable: true })
  } catch {
    globalThis.localStorage = memoryStorage
  }
  if (typeof window !== 'undefined') {
    try {
      Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true, writable: true })
    } catch {
      window.localStorage = memoryStorage
    }
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const RangeProto = window.Range && window.Range.prototype
  if (RangeProto && typeof RangeProto.getClientRects !== 'function') {
    RangeProto.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} })
    RangeProto.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0,
      toJSON: () => ({}),
    })
  }
  // CodeMirror also calls Element.prototype.getClientRects via various paths;
  // jsdom returns a list with no methods. Ensure both exist.
  if (typeof Element !== 'undefined' && !Element.prototype.getClientRects) {
    Element.prototype.getClientRects = function () { return [] }
  }
  // jsdom@29 exposes `localStorage` as a plain Object rather than the WebStorage
  // interface, so getItem/setItem/clear are missing. Provide a tiny in-memory
  // implementation so feature code (and tests like terminalZoom.test) work.
  if (typeof window.localStorage?.setItem !== 'function') {
    const store = new Map()
    const ls = {
      getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => { store.set(String(k), String(v)) },
      removeItem: (k) => { store.delete(String(k)) },
      clear: () => { store.clear() },
      key: (i) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size },
    }
    try {
      Object.defineProperty(window, 'localStorage', { value: ls, configurable: true })
      Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
    } catch {
      // ignore
    }
  }
}
