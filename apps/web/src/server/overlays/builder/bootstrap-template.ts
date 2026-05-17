/**
 * Overlay Builder — canonical bootstrap script.
 *
 * The compiler in `compiler.ts` (foundation task — not this slice)
 * splices this string into every compiled user-design HTML's <head>.
 * It is a LITERAL — never built from user input — so what ships at
 * runtime is exactly what was committed with the same SHA.
 *
 * Pieces:
 *   1. postMessage receiver for {type:'show'|'hide'|'update', data, slot?}
 *      envelope. show → body.cade-visible; hide → body.cade-exiting
 *      (stripped after exit duration); update → re-render with new data.
 *   2. cade-visible-gate-observer-v2 MutationObserver replicated from
 *      apps/web/public/overlays/v2/04-h2h-2/index.html — flips opacity
 *      transitions on every gated element so Chrome cross-origin iframe
 *      stuck-transition workaround stays armed.
 *   3. ?demo=1 guard — auto-show + auto-hide loop for OBS preview /
 *      admin preview iframe. Plain ?demo (no =1) does NOT trigger.
 *   4. __cadeBuilderRuntime global — empty by default; the compiler-
 *      emitted per-design block populates it with INITIAL_FETCH_PATH +
 *      REALTIME_KEY_EVENTS arrays that the Realtime injector reads.
 *
 * CLAUDE.md §14 contract pieces this script satisfies:
 *   - postMessage handler for show/hide/update envelope.
 *   - cade-visible / cade-exiting class swap on body.
 *   - cade-visible-gate-observer-v2 MutationObserver.
 *   - ?demo=1 guarded demo loop.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §6
 */

export const BOOTSTRAP_SCRIPT = `(function(){
  // ────────── __cadeBuilderRuntime global ──────────
  // The compiler-emitted per-design block populates this with
  // INITIAL_FETCH_PATH (string|null) + REALTIME_KEY_EVENTS (string[])
  // for each data-slot binding present in the design. The Realtime
  // injector reads these on document-ready and subscribes accordingly.
  if (!window.__cadeBuilderRuntime) {
    window.__cadeBuilderRuntime = {
      INITIAL_FETCH_PATH: null,
      REALTIME_KEY_EVENTS: [],
      onUpdate: function(data) {
        try {
          window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'update', data: data }
          }));
        } catch (e) { /* swallow */ }
      }
    };
  }

  // ────────── postMessage receiver ──────────
  var EXIT_DURATION_MS = 480;
  var exitTimer = null;

  function onMessage(ev) {
    var msg = ev && ev.data;
    if (!msg || typeof msg !== 'object') return;
    var type = msg.type;
    if (type === 'show') {
      if (exitTimer) { clearTimeout(exitTimer); exitTimer = null; }
      document.body.classList.remove('cade-exiting');
      document.body.classList.add('cade-visible');
      try { applyUpdate(msg.data, msg.slot); } catch (e) { /* swallow */ }
    } else if (type === 'hide') {
      document.body.classList.remove('cade-visible');
      document.body.classList.add('cade-exiting');
      if (exitTimer) clearTimeout(exitTimer);
      exitTimer = setTimeout(function(){
        document.body.classList.remove('cade-exiting');
        exitTimer = null;
      }, EXIT_DURATION_MS);
    } else if (type === 'update') {
      try { applyUpdate(msg.data, msg.slot); } catch (e) { /* swallow */ }
    }
  }
  window.addEventListener('message', onMessage);

  function applyUpdate(data, slot) {
    if (!data || typeof data !== 'object') return;
    // The compiler emits a per-design window.__cadeBuilderApplyUpdate()
    // override that walks data-slot DOM nodes and writes their
    // text/image content. Fall back to a no-op for shape-only designs.
    var fn = window.__cadeBuilderApplyUpdate;
    if (typeof fn === 'function') {
      fn(data, slot);
    }
  }

  // ────────── cade-visible-gate-observer-v2 ──────────
  // Replicated from apps/web/public/overlays/v2/04-h2h-2/index.html.
  // Per-element opacity-transition arming so the Chrome cross-origin
  // iframe stuck-transition quirk does not bury the entry animation.
  var GATE_TAG = 'cade-visible-gate-observer-v2';
  window.__cadeGateTag = GATE_TAG;

  function armGate() {
    var b = document.body;
    if (!b) return;
    var vis = b.classList.contains('cade-visible');
    var nodes = document.querySelectorAll('[data-element-id]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el.dataset.cadeTransition) {
        var existing = el.style.transition;
        el.style.transition = (existing ? existing + ', ' : '') + 'opacity 360ms ease-out';
        el.dataset.cadeTransition = '1';
      }
      if (vis) {
        el.style.setProperty('opacity', '1', 'important');
      } else {
        el.style.setProperty('opacity', '0', 'important');
      }
    }
  }

  armGate();
  try {
    new MutationObserver(armGate).observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
  } catch (e) { /* body not ready — observer will be set up later */ }

  // ────────── ?demo=1 guard ──────────
  // Only fires when the URL contains ?demo=1 (exact match). Used by OBS
  // preview iframes and the admin design-editor preview pane. MUST NOT
  // auto-fire on plain overlay routes pointed at by live OBS sources.
  try {
    var qs = new URLSearchParams(location.search);
    if (qs.get('demo') === '1') {
      setTimeout(function(){
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'show' }
        }));
      }, 800);
      setTimeout(function(){
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'hide' }
        }));
      }, 8000);
    }
  } catch (e) { /* swallow — SSR/Node environments without location */ }
})()`;
