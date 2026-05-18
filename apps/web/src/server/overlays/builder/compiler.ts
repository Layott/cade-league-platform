import { BOOTSTRAP_SCRIPT } from "./bootstrap-template";
import type { Animation, Binding, Design, Element, Scene, Style, Transform } from "./types";

/**
 * Wave 1A — JSON → HTML compiler.
 *
 * Pure function. Trusts pre-validated input (style/binding/animation
 * validators ran on the DB write path). Output satisfies CLAUDE.md §14
 * contract in every byte. Bound elements get `data-binding-*` attrs +
 * an injected `__OVERLAY_FEEDS__` registry so the bootstrap can wire
 * initial-fetch + Realtime per slot. Animations get one `@keyframes`
 * block per (type, phase) plus a per-element `animation:` rule under
 * the `body.cade-visible` gate.
 *
 * Caller is responsible for substituting `${sessionId}` in the rendered
 * HTML with the active broadcast session id before sending the response.
 */

// -----------------------------------------------------------------------------
// Font map (curated). Browser-system fonts have `null` and don't get @font-face.
// Custom uploaded fonts are looked up by family_name against overlay_user_design_fonts
// at compile time and added to this map dynamically (Wave 1B). For Wave 1A, only
// the curated brand fonts ship.
// -----------------------------------------------------------------------------

const FONT_MAP: Record<string, string | null> = {
  Agharti: "/overlays/v2/_assets/fonts/agharti-regular.woff2",
  Quedora: "/overlays/v2/_assets/fonts/quedora-regular.woff2",
  Inter: null,
  "JetBrains Mono": null,
};

// -----------------------------------------------------------------------------
// Feed registry — mirrors CLAUDE.md §14 auto-update matrix. `${sessionId}` is
// a placeholder the runtime route fills with the active session id.
// -----------------------------------------------------------------------------

type FeedSpec = {
  fetchPath: string | null; // null = event-driven only
  realtimeChannels: string[];
};

const FEED_REGISTRY: Record<string, FeedSpec> = {
  standings: {
    fetchPath: "/api/broadcast/sessions/${sessionId}/leaderboard",
    realtimeChannels: ["standings.changed", "snapshot.captured"],
  },
  live_score: {
    fetchPath: null,
    realtimeChannels: ["score.changed"],
  },
  top_scorers: {
    fetchPath: "/api/broadcast/sessions/${sessionId}/top-scorers",
    realtimeChannels: ["match.ended", "standings.changed"],
  },
  h2h: {
    fetchPath: "/api/broadcast/sessions/${sessionId}/h2h",
    realtimeChannels: ["standings.changed"],
  },
  match: {
    fetchPath: "/api/broadcast/sessions/${sessionId}/match-scores-day",
    realtimeChannels: ["score.changed", "match.ended", "standings.changed"],
  },
  match_day: {
    fetchPath: "/api/broadcast/sessions/${sessionId}/match-day",
    realtimeChannels: ["match.ended"],
  },
  custom_text: {
    fetchPath: null,
    realtimeChannels: ["custom_text.changed"],
  },
};

// -----------------------------------------------------------------------------
// Preset animation keyframes. `custom-css` is injected verbatim (already
// sanitized by animation-validator on the write path).
// -----------------------------------------------------------------------------

type AnimTypeLocal =
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "fade"
  | "scale"
  | "rotate"
  | "bounce"
  | "pulse"
  | "glow"
  | "shake"
  | "flip"
  | "custom-css";

function presetKeyframesFor(type: AnimTypeLocal, phase: "in" | "out"): string | null {
  const fromOpacity = phase === "in" ? 0 : 1;
  const toOpacity = phase === "in" ? 1 : 0;
  switch (type) {
    case "slide-left":
      return `@keyframes slide-left-${phase} { from { transform: translateX(-32px); opacity: ${fromOpacity}; } to { transform: translateX(0); opacity: ${toOpacity}; } }`;
    case "slide-right":
      return `@keyframes slide-right-${phase} { from { transform: translateX(32px); opacity: ${fromOpacity}; } to { transform: translateX(0); opacity: ${toOpacity}; } }`;
    case "slide-up":
      return `@keyframes slide-up-${phase} { from { transform: translateY(-32px); opacity: ${fromOpacity}; } to { transform: translateY(0); opacity: ${toOpacity}; } }`;
    case "slide-down":
      return `@keyframes slide-down-${phase} { from { transform: translateY(32px); opacity: ${fromOpacity}; } to { transform: translateY(0); opacity: ${toOpacity}; } }`;
    case "fade":
      return `@keyframes fade-${phase} { from { opacity: ${fromOpacity}; } to { opacity: ${toOpacity}; } }`;
    case "scale":
      return `@keyframes scale-${phase} { from { transform: scale(0.8); opacity: ${fromOpacity}; } to { transform: scale(1); opacity: ${toOpacity}; } }`;
    case "rotate":
      return `@keyframes rotate-${phase} { from { transform: rotate(-12deg); opacity: ${fromOpacity}; } to { transform: rotate(0); opacity: ${toOpacity}; } }`;
    case "bounce":
      return `@keyframes bounce-${phase} { 0% { transform: translateY(20px); opacity: ${fromOpacity}; } 60% { transform: translateY(-6px); opacity: 1; } 100% { transform: translateY(0); opacity: ${toOpacity}; } }`;
    case "pulse":
      return `@keyframes pulse-${phase} { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }`;
    case "glow":
      return `@keyframes glow-${phase} { 0%,100% { filter: drop-shadow(0 0 0 rgba(107,205,6,0)); } 50% { filter: drop-shadow(0 0 24px rgba(107,205,6,0.9)); } }`;
    case "shake":
      return `@keyframes shake-${phase} { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }`;
    case "flip":
      return `@keyframes flip-${phase} { from { transform: perspective(800px) rotateY(-90deg); opacity: ${fromOpacity}; } to { transform: perspective(800px) rotateY(0); opacity: ${toOpacity}; } }`;
    case "custom-css":
      return null; // emitted via element.animation custom keyframes literal
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// HTML escape (minimal — text content + attribute values).
// -----------------------------------------------------------------------------

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// -----------------------------------------------------------------------------
// CSS helpers.
// -----------------------------------------------------------------------------

function transformCss(t: Transform): string {
  const parts: string[] = [];
  if (t.rotation) parts.push(`rotate(${t.rotation}deg)`);
  if (t.scaleX !== 1 || t.scaleY !== 1) parts.push(`scale(${t.scaleX},${t.scaleY})`);
  return parts.length ? `transform: ${parts.join(" ")};` : "";
}

function rgbaFromHex(hex: string, opacity: number): string {
  // Accepts #RGB, #RRGGBB. Returns rgba(R,G,B,A).
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  let r = 0, g = 0, b = 0;
  if (m3) {
    r = parseInt(m3[1] + m3[1], 16);
    g = parseInt(m3[2] + m3[2], 16);
    b = parseInt(m3[3] + m3[3], 16);
  } else if (m6) {
    r = parseInt(m6[1], 16);
    g = parseInt(m6[2], 16);
    b = parseInt(m6[3], 16);
  } else {
    // Non-hex (e.g. CSS named color) — fall back to opaque hex pass-through.
    return hex;
  }
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function shadowCss(style: Style | null | undefined): string {
  if (!style) return "";
  // Wave 1B prefers the `shadows` array when present.
  if (Array.isArray(style.shadows) && style.shadows.length > 0) {
    const parts = style.shadows.map(
      (s) =>
        `${s.offsetX}px ${s.offsetY}px ${s.blur}px ${rgbaFromHex(s.color, s.opacity)}`,
    );
    return `box-shadow: ${parts.join(", ")};`;
  }
  // Wave 1A single-shadow back-compat path.
  const shadow = style.shadow;
  if (!shadow) return "";
  return `box-shadow: ${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${rgbaFromHex(shadow.color, shadow.opacity)};`;
}

function gradientCss(gradient: NonNullable<Style["gradient"]>): string {
  const stops = gradient.stops
    .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
    .join(", ");
  if (gradient.kind === "linear") {
    return `linear-gradient(${gradient.angle}deg, ${stops})`;
  }
  // radial
  const cxPct = Math.round(gradient.cx * 100);
  const cyPct = Math.round(gradient.cy * 100);
  return `radial-gradient(circle at ${cxPct}% ${cyPct}%, ${stops})`;
}

function filterCss(filter: Style["filter"]): string {
  if (!filter) return "";
  const parts: string[] = [];
  if (typeof filter.blur === "number" && filter.blur > 0) {
    parts.push(`blur(${filter.blur}px)`);
  }
  if (typeof filter.brightness === "number" && filter.brightness !== 1) {
    parts.push(`brightness(${filter.brightness})`);
  }
  if (typeof filter.hueRotate === "number" && filter.hueRotate !== 0) {
    parts.push(`hue-rotate(${filter.hueRotate}deg)`);
  }
  if (typeof filter.saturate === "number" && filter.saturate !== 1) {
    parts.push(`saturate(${filter.saturate})`);
  }
  return parts.length > 0 ? `filter: ${parts.join(" ")};` : "";
}

function polygonClipPath(sides: number): string {
  // Regular polygon inscribed in unit box. Vertex i at angle
  // `i * 2π / sides - π/2` (starts at top), mapped to [0..100%].
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (i * 2 * Math.PI) / sides - Math.PI / 2;
    const x = 50 + 50 * Math.cos(angle);
    const y = 50 + 50 * Math.sin(angle);
    pts.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
  }
  return `polygon(${pts.join(", ")})`;
}

function shapeCss(element: Element): string {
  if (element.elementType === "ellipse") {
    return "border-radius: 50%;";
  }
  if (element.elementType === "polygon") {
    const sides = element.style?.sides ?? 6;
    return `clip-path: ${polygonClipPath(sides)};`;
  }
  return "";
}

function fillCss(element: Element): string {
  const style = element.style;
  if (!style) return "";

  // Gradient takes precedence over solid fill.
  if (style.gradient) {
    const gradient = gradientCss(style.gradient);
    if (element.elementType === "text") {
      // Text gradient needs the bg-clip trick.
      return `background: ${gradient}; background-clip: text; -webkit-background-clip: text; color: transparent;`;
    }
    return `background: ${gradient};`;
  }

  const fill = style.fill;
  if (!fill) {
    // For line elements: emit stroke as background-color so the thin
    // rect appears coloured.
    if (element.elementType === "line" && style.stroke) {
      return `background-color: ${style.stroke};`;
    }
    return "";
  }

  if (element.elementType === "text") {
    return `color: ${fill};`;
  }
  if (
    element.elementType === "rect" ||
    element.elementType === "ellipse" ||
    element.elementType === "polygon"
  ) {
    return `background-color: ${fill};`;
  }
  return "";
}

function fontCss(s: Style | null | undefined): string {
  if (!s) return "";
  const parts: string[] = [];
  if (s.fontFamily) parts.push(`font-family: '${s.fontFamily}', sans-serif;`);
  if (typeof s.fontSize === "number") parts.push(`font-size: ${s.fontSize}px;`);
  if (typeof s.fontWeight === "number") parts.push(`font-weight: ${s.fontWeight};`);
  if (s.textAlign) parts.push(`text-align: ${s.textAlign};`);
  return parts.join(" ");
}

// -----------------------------------------------------------------------------
// Font collection — walk scene elements, collect unique fontFamily values that
// have a non-null FONT_MAP entry, emit @font-face for each.
// -----------------------------------------------------------------------------

function collectFontFaces(scene: Scene): string {
  const used = new Set<string>();
  for (const el of scene.elements) {
    const fam = el.style?.fontFamily;
    if (fam && FONT_MAP[fam]) used.add(fam);
  }
  const blocks: string[] = [];
  for (const family of used) {
    const path = FONT_MAP[family]!;
    blocks.push(
      `@font-face { font-family: '${family}'; src: url('${path}') format('woff2'); font-display: swap; }`,
    );
  }
  return blocks.join("\n");
}

// -----------------------------------------------------------------------------
// Animation collection — walk elements, build unique (type, phase) keyframes
// + per-element `animation:` rules under the correct gate.
// -----------------------------------------------------------------------------

function collectAnimationBlocks(scene: Scene): { keyframes: string; rules: string } {
  const keyframesSeen = new Set<string>();
  const keyframes: string[] = [];
  const rules: string[] = [];

  for (const el of scene.elements) {
    const a = el.animation as Animation | undefined;
    if (!a) continue;

    const buildRule = (
      phase: "in" | "out",
      anim: Animation["entry"] | Animation["exit"] | undefined,
      gate: string,
    ) => {
      if (!anim) return;
      const t = anim.type as AnimTypeLocal;
      const keyframesName = `${t}-${phase}`;
      if (!keyframesSeen.has(keyframesName)) {
        const block = presetKeyframesFor(t, phase);
        if (block) keyframes.push(block);
        keyframesSeen.add(keyframesName);
      }
      const dur = anim.durationMs ?? 400;
      const delay = anim.delayMs ?? 0;
      const easing = anim.easing ?? "ease-out";
      rules.push(
        `${gate} [data-element-id="${el.id}"] { animation: ${keyframesName} ${dur}ms ${easing} ${delay}ms both; }`,
      );
    };

    buildRule("in", a.entry, "body.cade-visible");
    buildRule("out", a.exit, "body.cade-exiting");

    if (a.loop) {
      const t = a.loop.type as AnimTypeLocal;
      const keyframesName = `${t}-in`;
      if (!keyframesSeen.has(keyframesName)) {
        const block = presetKeyframesFor(t, "in");
        if (block) keyframes.push(block);
        keyframesSeen.add(keyframesName);
      }
      const dur = a.loop.durationMs ?? 1200;
      const easing = a.loop.easing ?? "ease-in-out";
      rules.push(
        `body.cade-visible [data-element-id="${el.id}"] { animation: ${keyframesName} ${dur}ms ${easing} infinite; }`,
      );
    }
  }

  return { keyframes: keyframes.join("\n"), rules: rules.join("\n") };
}

// -----------------------------------------------------------------------------
// Feed collection — walk bindings, return unique feed names actually used.
// -----------------------------------------------------------------------------

function collectFeeds(scene: Scene): string[] {
  const seen = new Set<string>();
  for (const el of scene.elements) {
    if (el.binding?.feed) seen.add(el.binding.feed);
  }
  return Array.from(seen);
}

function feedsRegistryScript(scene: Scene): string {
  const feeds = collectFeeds(scene);
  if (feeds.length === 0) return "window.__OVERLAY_FEEDS__ = {};";
  const entries: string[] = [];
  for (const feed of feeds) {
    const spec = FEED_REGISTRY[feed];
    if (!spec) continue;
    const fetchPath = spec.fetchPath ? `'${spec.fetchPath}'` : "null";
    const channels = spec.realtimeChannels.map((c) => `'${c}'`).join(", ");
    entries.push(
      `  ${feed}: { fetchPath: ${fetchPath}, realtimeChannels: [${channels}] }`,
    );
  }
  return `window.__OVERLAY_FEEDS__ = {\n${entries.join(",\n")}\n};`;
}

// -----------------------------------------------------------------------------
// Element default style rule (always opacity 0 — gated by cade-visible).
// -----------------------------------------------------------------------------

function elementDefaultRule(el: Element): string {
  const t = el.transform;
  const parts: string[] = [
    `position: absolute`,
    `left: ${t.x}px`,
    `top: ${t.y}px`,
    `width: ${t.width}px`,
    `height: ${t.height}px`,
    `opacity: 0`,
    `z-index: ${el.zIndex}`,
  ];
  const tr = transformCss(t);
  if (tr) parts.push(tr.replace(/;$/, ""));
  const fill = fillCss(el);
  if (fill) parts.push(fill.replace(/;$/g, ""));
  const font = fontCss(el.style);
  if (font) parts.push(font.replace(/;$/g, ""));
  const sh = shadowCss(el.style);
  if (sh) parts.push(sh.replace(/;$/, ""));
  const flt = filterCss(el.style?.filter);
  if (flt) parts.push(flt.replace(/;$/, ""));
  const shape = shapeCss(el);
  if (shape) parts.push(shape.replace(/;$/, ""));
  if (el.visible === false) parts.push("display: none");
  return `[data-element-id="${el.id}"] { ${parts.join("; ")}; }`;
}

function elementVisibleRule(el: Element): string {
  return `body.cade-visible [data-element-id="${el.id}"] { opacity: ${el.transform.opacity}; }`;
}

function elementExitingRule(el: Element): string {
  return `body.cade-exiting [data-element-id="${el.id}"] { opacity: 0; }`;
}

// -----------------------------------------------------------------------------
// Path → SVG d attribute (Wave 1C).
// -----------------------------------------------------------------------------

type PathNodeShape = {
  x: number; y: number;
  ctrlInX: number; ctrlInY: number;
  ctrlOutX: number; ctrlOutY: number;
};

function pathSpecToD(nodes: PathNodeShape[], closed: boolean): string {
  if (nodes.length < 2) return "";
  const parts: string[] = [`M ${nodes[0].x} ${nodes[0].y}`];
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const cur = nodes[i];
    // Straight segment if every control point equals its anchor.
    const straight =
      prev.ctrlOutX === prev.x && prev.ctrlOutY === prev.y &&
      cur.ctrlInX === cur.x && cur.ctrlInY === cur.y;
    if (straight) {
      parts.push(`L ${cur.x} ${cur.y}`);
    } else {
      parts.push(`C ${prev.ctrlOutX} ${prev.ctrlOutY} ${cur.ctrlInX} ${cur.ctrlInY} ${cur.x} ${cur.y}`);
    }
  }
  if (closed) parts.push("Z");
  return parts.join(" ");
}

// -----------------------------------------------------------------------------
// Element DOM nodes.
// -----------------------------------------------------------------------------

function renderElementDom(el: Element): string {
  const attrs: string[] = [`data-element-id="${el.id}"`];

  if (el.binding) {
    const b = el.binding as Binding;
    attrs.push(`data-binding-feed="${htmlEscape(b.feed)}"`);
    attrs.push(`data-binding-path="${htmlEscape(b.fieldPath)}"`);
    if (b.templateString) {
      attrs.push(`data-binding-template="${htmlEscape(b.templateString)}"`);
    }
  }

  if (el.elementType === "text") {
    const text =
      (el.content?.["text"] as string | undefined) ??
      (el.binding?.templateString ? "--" : "");
    return `<div ${attrs.join(" ")}><span>${htmlEscape(text)}</span></div>`;
  }

  if (el.elementType === "image") {
    const assetPath = el.content?.["asset_path"] as string | undefined;
    let initialSrc: string;
    if (el.binding) {
      // Runtime resolves the real photoUrl via Realtime + feed. Initial: 1x1 transparent SVG.
      initialSrc =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
    } else if (assetPath) {
      initialSrc = `/overlay-user-assets/${htmlEscape(assetPath)}`;
    } else {
      initialSrc =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
    }
    return `<div ${attrs.join(" ")}><img data-element-img src="${initialSrc}" alt="" /></div>`;
  }

  // Wave 1C — path element renders as inline <svg>.
  if (el.elementType === "path") {
    const spec = (el.content as { path?: { nodes?: PathNodeShape[]; closed?: boolean } } | null)?.path;
    if (!spec || !spec.nodes || spec.nodes.length < 2) {
      return `<div ${attrs.join(" ")}></div>`;
    }
    const d = pathSpecToD(spec.nodes, spec.closed === true);
    const style = (el.style ?? {}) as { fill?: string; stroke?: string; strokeWidth?: number };
    const fill = style.fill ? htmlEscape(style.fill) : "transparent";
    const stroke = style.stroke ? htmlEscape(style.stroke) : "none";
    const strokeWidth = typeof style.strokeWidth === "number" ? style.strokeWidth : 0;
    const w = el.transform.width;
    const h = el.transform.height;
    return `<div ${attrs.join(" ")}><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" /></svg></div>`;
  }

  // rect / ellipse / line / polygon / group / data-slot / psd-layer
  // For Wave 1A, rect is the only non-text non-image we exercise. Others
  // render as empty div — Wave 1B+ extends the polygon/ellipse rendering.
  return `<div ${attrs.join(" ")}></div>`;
}

// -----------------------------------------------------------------------------
// Top-level compile entry point.
// -----------------------------------------------------------------------------

export function compileDesignToHtml(
  design: Design,
  sceneIndex: number = 0,
  opts: { demo?: boolean } = {},
): string {
  const scene =
    design.scenes[sceneIndex] ??
    design.scenes[0] ?? {
      id: "",
      designId: design.id,
      orderIndex: 0,
      name: null,
      durationMs: 5000,
      transitionIn: "fade",
      transitionOut: "fade",
      elements: [],
    };

  const fontFaces = collectFontFaces(scene);
  const { keyframes, rules: animationRules } = collectAnimationBlocks(scene);

  const elementDefaultRules = scene.elements.map(elementDefaultRule).join("\n");
  const elementVisibleRules = scene.elements.map(elementVisibleRule).join("\n");
  const elementExitingRules = scene.elements.map(elementExitingRule).join("\n");
  const elementDom = scene.elements.map(renderElementDom).join("\n");

  const feedsScript = feedsRegistryScript(scene);
  const demoFlag = opts.demo === true ? "window.__OVERLAY_DEMO__ = true;" : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="color-scheme" content="dark" />
<title>${htmlEscape(design.title)}</title>
<style>
html, body { background: transparent !important; color-scheme: dark; margin: 0; padding: 0; }
body { width: 1920px; height: 1080px; overflow: hidden; opacity: 1 !important; }
${fontFaces}
${elementDefaultRules}
${elementVisibleRules}
${elementExitingRules}
${keyframes}
${animationRules}
</style>
</head>
<body>
<script>${feedsScript}\n${demoFlag}</script>
${elementDom}
<script>${BOOTSTRAP_SCRIPT}</script>
</body>
</html>`;
}
