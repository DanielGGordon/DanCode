// jsdom polyfills for libraries that touch layout APIs.
//
// CodeMirror 6 calls `document.createRange().getClientRects()` to measure
// text geometry; jsdom does not implement these methods on Range, which
// raises an unhandled error in the requestAnimationFrame callback. Stub
// the missing methods so the editor mounts cleanly under tests. The values
// returned don't matter for the behaviour we assert — we test document
// state and DOM events, not layout/scroll/coordinates.
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
}
