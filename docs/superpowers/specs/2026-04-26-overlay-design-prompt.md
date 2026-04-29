# Overlay design prompt template — paste this when asking AI for a new overlay mockup

**Use this when:** you want to design a new CADE League broadcast overlay (or redesign an existing one) by prompting Claude.ai / ChatGPT / Gemini to produce a single self-contained HTML file you'll download and drop into `KNOWLEDGE/brand-assets/elements/v2/<key>/index.html`.

**How to use:** copy the template below into your chat, replace `<<...>>` placeholders with what you want, attach reference images / videos / Figma exports if you have them, send. The AI's output will satisfy the project's contract (CLAUDE.md §14) so it works the moment you save it.

---

## Copy-paste template

```
You are designing a single self-contained HTML file for the CADE Esports League broadcast overlay system. The file MUST satisfy the project's overlay contract or it will fail to render correctly inside OBS / vMix / Streamlabs / Restream.

# OVERLAY BRIEF
- Overlay key (slug, lowercase + hyphens): <<e.g. 19-stinger-celebration>>
- One-sentence purpose: <<e.g. "5-second goal-celebration stinger that blows in from left, holds 2s, exits right">>
- Type: <<full-canvas (covers entire 1920×1080) | widget (small box, transparent canvas around) | matchup (player photos + stats) | data-feed (reads payload then renders) | stinger (animation only, no data)>>
- Sound: <<silent | optional WAV at /overlays/v2/_assets/audio/<filename>>>
- Duration: <<e.g. "auto-hide after 5s" or "stays until Hide trigger" or "infinite loop with looped CSS animation">>
- Trigger payload shape (JSON, optional fields ok): <<e.g. {playerName: string, score: number, soundSlot?: 'goal-A'|'goal-B'}>>

# REFERENCE
<<paste a screenshot, Figma link, or describe in 2-3 sentences the visual style. Mention any motion you want (e.g. "bg pulses green, text snaps in, exit is flash-cut").>>

# HARD CONSTRAINTS — must satisfy ALL of these or the overlay will break

## 1. Document head
- `<!DOCTYPE html>` + `<html lang="en">`
- `<meta charset="UTF-8" />`
- `<meta name="color-scheme" content="dark" />` ← critical, without this Chrome paints iframe canvas WHITE behind transparent body
- `<meta name="viewport" content="width=1920, initial-scale=1" />`
- `<title>` with format `CADE — <OVERLAY NAME>`

## 2. Body + canvas (paste this CSS as-is — non-negotiable)
```css
html, body {
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  background: transparent !important;
  color-scheme: dark;
  margin: 0;
  padding: 0;
}
body { opacity: 1 !important; }   /* body itself never hidden — only its children */
* { box-sizing: border-box; margin: 0; padding: 0; }
```

## 3. Brand tokens (use exactly these as CSS variables)
```css
:root {
  --green: #6bcd06;        /* primary */
  --green-bright: #8aff15;
  --green-glow: rgba(107, 205, 6, 0.55);
  --pink: #fe036d;         /* secondary */
  --pink-glow: rgba(254, 3, 109, 0.55);
  --black: #050505;
  --ink: #ffffff;
  --display: 'Agharti', 'Impact', sans-serif;
  --accent: 'Quedora', 'Inter', sans-serif;
}
```

### 3a. Design system tokens (added 2026-04-29 Phase A)
Full-canvas overlays MUST also support runtime overrides from the design system. Reference these via `var(--overlay-X, <fallback>)` so admins can theme via `/admin/broadcast/v2/design`:

```css
.bg-fill {
  /* fallback to canonical background; design system can swap via admin upload */
  background-image: var(--overlay-bg-image, url('/overlays/v2/_assets/designsample/ELITE%20S2%20BG.png'));
  background-size: cover;
  background-position: center;
}
.brand-color { color: var(--overlay-accent-color, #6bcd06); }
.title { font-family: var(--overlay-font-display, 'Agharti'), sans-serif; }
```

Available tokens (server-side seeded, see `apps/web/src/server/overlays/design/defaults.ts`):
- `--overlay-bg-color` (color) · `--overlay-bg-image` (image, full-canvas only) · `--overlay-accent-color` (color)
- `--overlay-text-color` (color) · `--overlay-font-display` (font) · `--overlay-font-body` (font)
- `--overlay-scale` (number) · `--overlay-pos-x` (number) · `--overlay-pos-y` (number)
- `--overlay-partner-strip-show` (boolean) · `--overlay-pattern` (enum) · `--overlay-row-highlight-count` (number)

The bootstrap script that decodes `?tokens=<b64>&previewTokens=<b64>` from the iframe URL is auto-injected by the design-system pipeline — do NOT include it in your HTML mockup. The admin live-preview iframe + OBS browser sources both honour these tokens after Phase A.

## 4. Brand fonts (paste this @font-face block — paths are absolute, served from /public)
```css
@font-face {
  font-family: 'Agharti';
  src: url('/overlays/v2/_assets/fonts/agharti-family-2026-03-23-03-20-06-utc%20MAINPRIMARY%20FONT/Family%20Deliverables/Agharti-Bold.woff2') format('woff2');
  font-weight: 700; font-style: normal; font-stretch: 100%; font-display: block;
}
@font-face {
  font-family: 'Agharti';
  src: url('/overlays/v2/_assets/fonts/agharti-family-2026-03-23-03-20-06-utc%20MAINPRIMARY%20FONT/Family%20Deliverables/Agharti-Black.woff2') format('woff2');
  font-weight: 900; font-style: normal; font-stretch: 100%; font-display: block;
}
@font-face {
  font-family: 'Quedora';
  src: url('/overlays/v2/_assets/fonts/quedora-boxy-modern-minimalist-futuristic-font-2026-03-23-03-41-30-utc%20SECONDARY%20FONT/Quedora%20Main%20Files/woff%202/Quedora-Bold.woff2') format('woff2');
  font-weight: 700; font-style: normal; font-display: block;
}
```

## 5. Default-OFF gate (must comply)
- The `<body>` element must NOT carry the literal class `cade-visible` in your HTML markup. Only the broadcast control panel adds it at runtime when the overlay is triggered.
- All visible elements (`.bg-image`, `.stage`, `.title`, etc.) must default to `opacity: 0`.
- Add CSS rules:
  ```css
  body.cade-visible .stage,
  body.cade-visible .bg-image,
  body.cade-visible .title { opacity: 1; transition: opacity 320ms ease-out; }
  body.cade-exiting .stage,
  body.cade-exiting .bg-image,
  body.cade-exiting .title { opacity: 0; transition: opacity 280ms ease-in; }
  ```

## 6. Per-element gate observer (paste this script tag verbatim — Chrome iframe transition workaround)
```html
<script>
(function(){
  // cade-visible-gate-observer-v2 — flips inline opacity !important on gated elements when body.cade-visible is set.
  // Required because Chrome cross-origin iframe lifecycle eats CSS transitions on the body class itself.
  var SEL = '.bg-image, .bg-vignette, .bg-grain, .stage, .title, .body, .top-band, .partners, .chevrons, .season-mark';
  function flip(visible) {
    document.querySelectorAll(SEL).forEach(function(el){
      el.style.setProperty('opacity', visible ? '1' : '0', 'important');
      el.style.setProperty('transition', visible ? 'opacity 320ms ease-out' : 'opacity 280ms ease-in', 'important');
    });
  }
  var mo = new MutationObserver(function(){
    var visible = document.body.classList.contains('cade-visible');
    var exiting = document.body.classList.contains('cade-exiting');
    if (visible) flip(true);
    else if (exiting) flip(false);
  });
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // initial state
  flip(document.body.classList.contains('cade-visible'));
})();
</script>
```

## 7. postMessage handler (paste this — wires the overlay to the broadcast control panel + Realtime feed)
```html
<script>
(function(){
  // Receives {type: 'show'|'hide'|'update', data?, slot?, event?, payload?} from parent frame.
  // - 'show' → add cade-visible class + render data into DOM
  // - 'hide' → drop cade-visible, add cade-exiting briefly, then strip cade-exiting
  // - 'update' → re-render with new data without changing visibility class
  // - Realtime feed events arrive as {type:'update', event:'standings.changed', payload:{rows:[...]}} etc — handle inside render().
  function render(data) {
    if (!data) return;
    // Replace this with your overlay's render logic. Read from data.<field>.
    // Example: var nameEl = document.querySelector('.player-name'); if (nameEl && data.playerName) nameEl.textContent = data.playerName;
    <<INSERT YOUR RENDER LOGIC HERE>>
  }
  function show(data) {
    document.body.classList.remove('cade-exiting');
    document.body.classList.add('cade-visible');
    if (data) render(data);
  }
  function hide() {
    document.body.classList.remove('cade-visible');
    document.body.classList.add('cade-exiting');
    setTimeout(function(){ document.body.classList.remove('cade-exiting'); }, 360);
  }
  window.addEventListener('message', function(e){
    if (!e.data || typeof e.data !== 'object') return;
    var type = e.data.type;
    if (type === 'show') show(e.data.data || null);
    else if (type === 'hide') hide();
    else if (type === 'update') render(e.data.data || e.data.payload || null);
  });
  // Demo loop — only fires when ?demo=1. NEVER auto-show without that flag.
  if (new URLSearchParams(location.search).get('demo') === '1') {
    setInterval(function(){
      show({ <<INSERT EXAMPLE DEMO PAYLOAD>> });
      setTimeout(hide, 4500);
    }, 6000);
  }
})();
</script>
```

## 8. Photos + assets
- Player headshots: `/overlays/v2/_assets/players/processed/<slug>/headshot_<NN>_nobg.png` where slug is one of: `adefola`, `anife`, `baji_jnr`, `dadaboi`, `faruk`, `guru`, `kaykay`, `killer_freak`, `kingnonex`, `mitch`, `mr_oga`, `tactical`, `wolevation`. NN ranges 01-05 (Anife only has 02-05).
- Org logos: `/overlays/v2/_assets/Orgs/<ORG NAME> - <PLAYER NAME>.png` — case-sensitive.
- League logos: `/overlays/v2/_assets/logos/cade.png`, `gameevo.png`, `pro-league.png`.
- Background textures (use sparingly): `/overlays/v2/_assets/designsample/ELITE%20S2%20BG.png`.
- For h2h/data-driven overlays — DO NOT hardcode photo paths. Build a `PLAYER_HEADSHOT` JS map keyed by slug and look up via `data.players[i].slug` in your render function.

## 9. Animation guidelines
- Entry duration: 200-400ms (snap, not slide).
- Hold: depends on overlay (timer = until Hide, stinger = 1-2s, score-bug = until Hide).
- Exit: 280-500ms ease-in fade or slide.
- Avoid jarring transitions — Chrome cross-origin iframe will eat anything subtle. Use opacity + transform, not background-color animations.
- Pulse / shimmer / shake loops on accent elements (chevrons, partner marquee, badge dots) keep the overlay alive when held for long.
- Sound: optional, exposed via `data.soundSlot`. If you add audio elements, default `<audio>` `volume="0.6"` and trigger play in the `show()` handler.

## 10. File output requirements
- Single HTML file, NO external CSS/JS files (everything inline in `<style>` and `<script>`).
- File must be valid standalone HTML: opening it directly in Chrome with `?demo=1` should run the demo loop. Without the query string, the page loads to a blank screen (default-OFF).
- Total size target: < 200 KB (excluding referenced fonts/images).
- Must work at 1920×1080 — test by resizing your browser to that res or using Chrome DevTools device emulation.

# DELIVERABLE
A single `<html>` file. Provide the full contents of the file, ready to copy/paste into `KNOWLEDGE/brand-assets/elements/v2/<<overlay-key>>/index.html` then run `cd apps/web && npm run sync:overlays` to mirror it into the public dir.

# ABSOLUTE DON'TS
- Do NOT use external CDNs (Google Fonts, Tailwind CDN, etc.) — fonts must be the brand woff2s, no internet round-trip.
- Do NOT add `cade-visible` to the body's literal class attribute — only postMessage adds it at runtime.
- Do NOT remove the `cade-visible-gate-observer-v2` script — it's the Chrome iframe transition workaround.
- Do NOT hardcode session IDs, tokens, or sample data outside the demo loop.
- Do NOT use `position: absolute` without an explicit parent `position: relative` — overlay layout breaks at 1920×1080 if absolute escapes its container.
- Do NOT use `vh`/`vw` units — canvas is fixed 1920×1080, use pixels.
```

---

## Workflow once the AI gives you the file

1. Save the AI's output to `KNOWLEDGE/brand-assets/elements/v2/<your-key>/index.html`.
2. Run `cd apps/web && npm run sync:overlays` (one-shot mirror).
3. Preview at `http://localhost:3030/overlays/v2/<your-key>/index.html?demo=1` after `npx next dev -p 3030`.
4. If it's a new overlay, also wire:
   - Add `<your-key>` to `apps/web/src/components/broadcast/v2/overlay-keys.ts`
   - Add Zod schema to `apps/web/src/server/overlays/schemas.ts`
   - Create control component at `apps/web/src/components/broadcast/v2/controls/<YourControl>.tsx`
   - Register in `apps/web/src/app/admin/broadcast/v2/[sessionId]/ControlGrid.tsx`
5. Test trigger pipeline at `/admin/broadcast/v2/<sessionId>` — click your new card's Trigger.
6. Run `npm run lint && npm run build`. Commit + push.

If the AI's output fails any of the rules above (visible white bg, doesn't trigger, etc), paste THIS document back into the chat and ask it to fix the specific failure. The full contract is here so it can self-correct.

## Common AI output failures (and how to spot them)

| Symptom | Root cause |
|---|---|
| Iframe shows WHITE bg | Missing `<meta name="color-scheme" content="dark">` and/or CSS `color-scheme: dark` |
| Overlay shows on page load (no Trigger needed) | Body has literal `cade-visible` class OR demo loop without `?demo=1` guard |
| Overlay shows for 1 frame then disappears | Transition stuck — gate observer script missing or its SEL list misses your element |
| Photos broken when slug changes | Hardcoded `<img src>` path instead of `PLAYER_HEADSHOT[slug]` lookup in render() |
| Fonts render as Times New Roman | Wrong asset path or AI used Google Fonts CDN |
| Overlay positioned wrong at 1080p | Used `vh`/`vw` instead of `px` |

## Reference: existing overlays

The 16 working overlays at `apps/web/public/overlays/v2/<key>/index.html` are your living style guide:
- Simple toggle: `01-brb`, `12-starting-soon`, `13-stream-ended`
- Widget: `02-timer`, `08-lower-third`, `09-secondary-score-bug`, `10-up-next-bug`
- Matchup: `04-h2h-2`, `05-h2h-3`, `06-h2h-5`
- Data feed: `07-leaderboard`, `11-match-scores-day`, `14-top-scorers`, `15-orgs`, `16-coaches`, `17-penalties`

Pick the closest neighbour, copy its structure, modify for your new design.
