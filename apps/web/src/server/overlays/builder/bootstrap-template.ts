/**
 * Overlay Builder — canonical bootstrap script.
 *
 * The compiler in `compiler.ts` (foundation task — not this slice)
 * splices this string into every compiled user-design HTML's <head>.
 * It is a LITERAL — never built from user input — so what ships at
 * runtime is exactly what was committed with the same SHA.
 *
 * Pieces:
 *   1. postMessage receiver for {type:'show'|'hide'|'update'|'next-scene',
 *      data, slot?} envelope. show → body.cade-visible (+ kicks off
 *      runSequence when scenes meta present); hide → body.cade-exiting
 *      (stripped after exit duration) + stopSequence; update → re-render
 *      with new data; next-scene → advance the sequence one step.
 *   2. cade-visible-gate-observer-v2 MutationObserver replicated from
 *      apps/web/public/overlays/v2/04-h2h-2/index.html — flips opacity
 *      transitions on every gated element so Chrome cross-origin iframe
 *      stuck-transition workaround stays armed.
 *   3. ?demo=1 guard — auto-show + auto-hide loop for OBS preview /
 *      admin preview iframe. Plain ?demo (no =1) does NOT trigger.
 *   4. __cadeBuilderRuntime global — empty by default; the compiler-
 *      emitted per-design block populates it with INITIAL_FETCH_PATH +
 *      REALTIME_KEY_EVENTS arrays that the Realtime injector reads.
 *   5. runSequence driver (Wave 3A) — consumes
 *      window.__OVERLAY_SCENES_META__ (emitted by sequence-mode
 *      compiler), flips data-scene-state through
 *      inactive → entering → active → exiting on a per-scene
 *      durationMs schedule. cut transitions are zero-duration no-ops.
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

  // ────────── runSequence driver (Wave 3A) ──────────
  // Consumes window.__OVERLAY_SCENES_META__ (an array of
  // { id, durationMs, transitionIn, transitionOut } emitted by the
  // sequence-mode compiler) and flips data-scene-state through
  // inactive → entering → active → exiting on a per-scene schedule.
  // SCENE_TRANSITION_DURATION matches the compiler-emitted
  // @keyframes scene-<dir>-{in,out} timing (apps/web/src/server/
  // overlays/builder/compiler.ts::SCENE_TRANSITION_DURATION_MS).
  var SCENE_TRANSITION_DURATION = 480;
  var seqIndex = -1;
  var seqTimers = [];
  var seqRunning = false;

  function clearSeqTimers() {
    for (var i = 0; i < seqTimers.length; i++) {
      try { clearTimeout(seqTimers[i]); } catch (e) { /* swallow */ }
    }
    seqTimers = [];
  }

  function resetAllScenes() {
    var nodes = document.querySelectorAll('[data-scene-id]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute('data-scene-state', 'inactive');
    }
  }

  function activateScene(meta, onActive) {
    if (!meta) return;
    var el = document.querySelector('[data-scene-id="' + meta.id + '"]');
    if (!el) {
      if (typeof onActive === 'function') onActive();
      return;
    }
    var enterDur = meta.transitionIn === 'cut' ? 0 : SCENE_TRANSITION_DURATION;
    el.setAttribute('data-scene-state', 'entering');
    var t = setTimeout(function(){
      el.setAttribute('data-scene-state', 'active');
      if (typeof onActive === 'function') onActive();
    }, enterDur);
    seqTimers.push(t);
  }

  function runSequence() {
    var meta = window.__OVERLAY_SCENES_META__;
    if (!meta || !meta.length) return;
    clearSeqTimers();
    resetAllScenes();
    seqIndex = 0;
    seqRunning = true;
    scheduleScene();
  }

  function scheduleScene() {
    if (!seqRunning) return;
    var meta = window.__OVERLAY_SCENES_META__;
    if (!meta || seqIndex < 0 || seqIndex >= meta.length) {
      seqRunning = false;
      return;
    }
    var current = meta[seqIndex];
    activateScene(current, function(){
      // Hold for the scene's own durationMs, then transition out and
      // advance to the next scene (if any).
      var hold = setTimeout(function(){
        if (!seqRunning) return;
        advanceScene();
      }, current.durationMs || 0);
      seqTimers.push(hold);
    });
  }

  function advanceScene() {
    var meta = window.__OVERLAY_SCENES_META__;
    if (!meta || !meta.length) return;
    if (seqIndex < 0 || seqIndex >= meta.length) return;
    var current = meta[seqIndex];
    var el = current
      ? document.querySelector('[data-scene-id="' + current.id + '"]')
      : null;
    var exitDur = current && current.transitionOut === 'cut'
      ? 0
      : SCENE_TRANSITION_DURATION;
    if (el) el.setAttribute('data-scene-state', 'exiting');
    var t = setTimeout(function(){
      if (el) el.setAttribute('data-scene-state', 'inactive');
      seqIndex += 1;
      if (seqIndex >= meta.length) {
        seqRunning = false;
        return;
      }
      scheduleScene();
    }, exitDur);
    seqTimers.push(t);
  }

  function stopSequence() {
    seqRunning = false;
    clearSeqTimers();
    resetAllScenes();
    seqIndex = -1;
  }

  function onMessage(ev) {
    var msg = ev && ev.data;
    if (!msg || typeof msg !== 'object') return;
    var type = msg.type;
    if (type === 'show') {
      if (exitTimer) { clearTimeout(exitTimer); exitTimer = null; }
      document.body.classList.remove('cade-exiting');
      document.body.classList.add('cade-visible');
      try { applyUpdate(msg.data, msg.slot); } catch (e) { /* swallow */ }
      if (window.__OVERLAY_SCENES_META__ && window.__OVERLAY_SCENES_META__.length) {
        try { runSequence(); } catch (e) { /* swallow */ }
      }
    } else if (type === 'hide') {
      try { stopSequence(); } catch (e) { /* swallow */ }
      document.body.classList.remove('cade-visible');
      document.body.classList.add('cade-exiting');
      if (exitTimer) clearTimeout(exitTimer);
      exitTimer = setTimeout(function(){
        document.body.classList.remove('cade-exiting');
        exitTimer = null;
      }, EXIT_DURATION_MS);
    } else if (type === 'update') {
      try { applyUpdate(msg.data, msg.slot); } catch (e) { /* swallow */ }
    } else if (type === 'next-scene') {
      try { advanceScene(); } catch (e) { /* swallow */ }
    }
  }
  window.addEventListener('message', onMessage);

  function applyUpdate(data, slot) {
    if (!data || typeof data !== 'object') return;
    // The compiler-emitted per-design window.__cadeBuilderApplyUpdate()
    // (if present) takes precedence — design-specific data-slot mappings
    // override the generic resolver below.
    var fn = window.__cadeBuilderApplyUpdate;
    if (typeof fn === 'function') {
      try { fn(data, slot); } catch (e) { /* swallow */ }
    }
    // Generic binding resolver — Gap 3 (2026-05-19). Walks every
    // [data-binding-feed] node and writes its resolved value into the
    // first <span> (text elements) or <img data-element-img> (image
    // elements). The data payload shape is normalised:
    //   - top-level keys may be feed names (data.standings, data.match …)
    //   - OR the payload may already be unwrapped (single-feed designs)
    // We try feed-prefixed lookup first, then unprefixed.
    try { applyBindings(data); } catch (e) { /* swallow */ }
  }

  // ────────── Generic binding resolver ──────────
  // Resolves the same path grammar accepted by ManualBindEditor + the
  // server-side binding-validator:
  //   identifiers · [N] · . separators
  // and supports template strings of the form "literal \${path} literal".
  function resolvePath(root, path) {
    if (!path) return root;
    var re = /[A-Za-z_][A-Za-z0-9_]*|\\[\\d+\\]/g;
    var tokens = path.match(re) || [];
    var cur = root;
    for (var i = 0; i < tokens.length; i++) {
      if (cur == null) return undefined;
      var t = tokens[i];
      if (t.charAt(0) === '[') {
        var idx = Number(t.slice(1, -1));
        cur = cur[idx];
      } else {
        cur = cur[t];
      }
    }
    return cur;
  }

  function applyTemplate(feed, root, tpl) {
    return tpl.replace(/\\$\\{([^}]+)\\}/g, function(_m, expr) {
      var p = expr;
      if (p.indexOf(feed) === 0) p = p.slice(feed.length);
      if (p.charAt(0) === '.') p = p.slice(1);
      var v = resolvePath(root, p);
      return v == null ? '' : String(v);
    });
  }

  function applyBindings(data) {
    var nodes = document.querySelectorAll('[data-binding-feed]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var feed = el.getAttribute('data-binding-feed');
      var path = el.getAttribute('data-binding-path') || '';
      var tpl = el.getAttribute('data-binding-template');
      // Resolve the feed root — prefer namespaced data[feed] when present;
      // fall back to the whole payload (single-feed scenarios).
      var root = data && Object.prototype.hasOwnProperty.call(data, feed)
        ? data[feed]
        : data;
      var value;
      if (tpl) {
        value = applyTemplate(feed, root, tpl);
      } else {
        var raw = resolvePath(root, path);
        value = raw == null ? '' : String(raw);
      }
      // Text element: write to inner <span>.
      var span = el.querySelector('span');
      if (span) {
        span.textContent = String(value);
        continue;
      }
      // Image element: write src to <img data-element-img>.
      var img = el.querySelector('img[data-element-img]');
      if (img && value) {
        img.setAttribute('src', String(value));
      }
    }
  }

  // ────────── Demo data injector ──────────
  // Gap 3 (2026-05-19) — in ?demo=1 mode the bootstrap auto-fires a
  // {type:'show', data: DEMO_DATA} envelope so bindings actually paint
  // their resolved values during preview (instead of staying on the
  // placeholder content). Same shape as ManualBindEditor's MOCK so the
  // sample-feed dropdown preview matches the runtime render.
  var DEMO_DATA = {
    standings: [
      { name: 'ADEFOLA', points: 24, gd: 12 },
      { name: 'ANIFE', points: 22, gd: 9 },
      { name: 'BAJI JNR', points: 21, gd: 6 }
    ],
    live_score: {
      home_name: 'ADEFOLA',
      away_name: 'ANIFE',
      home_score: 2,
      away_score: 1,
      clock: '12:34'
    },
    top_scorers: [
      { name: 'ADEFOLA', goals: 14, photoUrl: '' }
    ],
    h2h: {
      playerA: { name: 'ADEFOLA', winProbPct: 58 },
      playerB: { name: 'ANIFE', winProbPct: 42 }
    },
    match: { home_name: 'ADEFOLA', away_name: 'ANIFE' },
    match_day: [{ home_name: 'ADEFOLA', away_name: 'ANIFE', kickoff: '20:00' }],
    custom_text: { caster_1_name: 'Sample' }
  };

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
  //
  // Gap 3 (2026-05-19) — show envelope now carries DEMO_DATA so any
  // [data-binding-*] elements render their resolved values during demo
  // preview. Live OBS sources continue to consume real Realtime feeds.
  try {
    var qs = new URLSearchParams(location.search);
    if (qs.get('demo') === '1') {
      setTimeout(function(){
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'show', data: DEMO_DATA }
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
