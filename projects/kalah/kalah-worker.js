// kalah-worker.js
//
// Background thread for the Kalah engine. The fetch shim in kalah.html
// posts {id, method, args} messages here; we route to the corresponding
// KalahEngine function and post the result back tagged with the same id.
//
// This keeps the depth-12 alpha-beta search off the UI thread — the page
// stays at 60fps even during a multi-second expand or a long line-apply.
//
// The transposition table inside kalah-engine.js is a worker-local global,
// so it persists across messages naturally and warms up over the session.

// Cache-bust: GitHub Pages serves kalah-engine.js with a long Cache-Control
// max-age, and the previous deploy ended with `})(window);` (which throws
// inside a Worker because there's no `window`). Bump this query when the
// engine changes to force browsers to fetch the new version.
importScripts("./kalah-engine.js?v=2");

self.onmessage = function (e) {
  var msg = e.data || {};
  var id = msg.id;
  var method = msg.method;
  var args = msg.args;

  var engine = self.KalahEngine;
  var fn = engine && engine[method];
  if (typeof fn !== "function") {
    self.postMessage({ id: id, error: "unknown method: " + method });
    return;
  }

  try {
    var result = fn(args);
    // Engine functions are synchronous today, but tolerate a Promise just
    // in case some method later goes async (e.g. WASM init).
    Promise.resolve(result).then(
      function (r) { self.postMessage({ id: id, result: r }); },
      function (err) { self.postMessage({ id: id, error: String(err) }); }
    );
  } catch (err) {
    self.postMessage({ id: id, error: String(err) });
  }
};
