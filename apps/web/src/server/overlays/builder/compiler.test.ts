import { describe, expect, it } from "vitest";
import { compileDesignToHtml } from "./compiler";
import { designRectTextImage } from "./fixtures/design-rect-text-image";
import { designWithBinding } from "./fixtures/design-with-binding";
import { designWithAnimation } from "./fixtures/design-with-animation";

describe("compileDesignToHtml — §14 contract", () => {
  const html = compileDesignToHtml(designRectTextImage, 0);

  it("emits doctype + lang + meta charset + color-scheme dark", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="UTF-8"');
    expect(html).toContain('name="color-scheme" content="dark"');
  });

  it("sets title from design", () => {
    expect(html).toContain("<title>Fixture: rect + text + image</title>");
  });

  it("forces transparent canvas + dark scheme + opaque body", () => {
    expect(html).toMatch(
      /html,\s*body\s*\{[^}]*background:\s*transparent\s*!important[^}]*\}/,
    );
    expect(html).toMatch(/color-scheme:\s*dark/);
    expect(html).toMatch(/body\s*\{[^}]*opacity:\s*1\s*!important[^}]*\}/);
  });

  it("locks body to 1920x1080 with overflow hidden", () => {
    expect(html).toMatch(/width:\s*1920px/);
    expect(html).toMatch(/height:\s*1080px/);
    expect(html).toMatch(/overflow:\s*hidden/);
  });

  it("emits per-element default rule with opacity 0", () => {
    expect(html).toContain('[data-element-id="00000000-0000-0000-0000-000000000100"]');
    expect(html).toMatch(
      /\[data-element-id="00000000-0000-0000-0000-000000000100"\]\s*\{[^}]*opacity:\s*0/,
    );
  });

  it("emits cade-visible gate with element opacity restored", () => {
    expect(html).toMatch(
      /body\.cade-visible\s+\[data-element-id="00000000-0000-0000-0000-000000000100"\]\s*\{[^}]*opacity:\s*1/,
    );
  });

  it("emits cade-exiting gate forcing element back to 0", () => {
    expect(html).toMatch(
      /body\.cade-exiting\s+\[data-element-id="00000000-0000-0000-0000-000000000100"\]\s*\{[^}]*opacity:\s*0/,
    );
  });

  it("emits <div> per element with data-element-id", () => {
    expect(html).toContain('data-element-id="00000000-0000-0000-0000-000000000100"');
    expect(html).toContain('data-element-id="00000000-0000-0000-0000-000000000101"');
    expect(html).toContain('data-element-id="00000000-0000-0000-0000-000000000102"');
  });

  it("renders text content for text elements", () => {
    expect(html).toContain(">HELLO<");
  });

  it("renders <img> for image elements", () => {
    expect(html).toMatch(/<img[^>]+data-element-img/);
    expect(html).toContain("/overlay-user-assets/image/logo-test.png");
  });

  it("loads @font-face for Agharti when used", () => {
    expect(html).toMatch(/@font-face\s*\{[^}]*font-family:\s*['"]?Agharti/);
    expect(html).toContain("/overlays/v2/_assets/fonts/agharti-regular.woff2");
  });

  it("injects BOOTSTRAP_SCRIPT inline at end of body", () => {
    expect(html).toContain("<script>");
    // Bootstrap exports a marker constant the runtime can check.
    expect(html).toMatch(/cade-visible-gate-observer-v2/);
  });
});

describe("compileDesignToHtml — data binding", () => {
  const html = compileDesignToHtml(designWithBinding, 0);

  it("emits data-binding-* attrs on bound element", () => {
    expect(html).toContain('data-binding-feed="standings"');
    expect(html).toContain('data-binding-path="standings[0].name"');
    expect(html).toContain('data-binding-template="${standings[0].name}"');
  });

  it("emits __OVERLAY_FEEDS__ with standings entry", () => {
    expect(html).toContain("window.__OVERLAY_FEEDS__");
    expect(html).toMatch(/standings:\s*\{[^}]*fetchPath:/);
    expect(html).toContain("/leaderboard");
    expect(html).toMatch(/realtimeChannels:\s*\[[^\]]*['"]standings\.changed['"]/);
  });

  it("does not include feeds that are not used", () => {
    // designWithBinding only uses standings — top_scorers should be absent.
    expect(html).not.toMatch(/top_scorers:\s*\{/);
  });

  it("uses ${sessionId} placeholder in fetchPath", () => {
    expect(html).toContain("${sessionId}");
  });
});

describe("compileDesignToHtml — animations", () => {
  const html = compileDesignToHtml(designWithAnimation, 0);

  it("emits @keyframes for slide-left entry", () => {
    expect(html).toContain("@keyframes slide-left-in");
    expect(html).toMatch(/translateX\(-32px\)/);
  });

  it("emits per-element animation rule referencing the keyframes", () => {
    expect(html).toMatch(
      /body\.cade-visible\s+\[data-element-id="00000000-0000-0000-0000-000000000300"\]\s*\{[^}]*animation:[^}]*slide-left-in/,
    );
    expect(html).toMatch(/600ms/);
    expect(html).toMatch(/ease-out/);
  });
});

describe("compileDesignToHtml — opts.demo", () => {
  it("does NOT auto-show when demo flag is false", () => {
    const html = compileDesignToHtml(designRectTextImage, 0, { demo: false });
    expect(html).not.toContain("__OVERLAY_DEMO__ = true");
  });

  it("sets demo flag when opts.demo=true", () => {
    const html = compileDesignToHtml(designRectTextImage, 0, { demo: true });
    expect(html).toContain("__OVERLAY_DEMO__ = true");
  });
});

import { designWave1b } from "./fixtures/design-wave-1b";
import { designWithPath } from "./fixtures/design-with-path";

describe("compileDesignToHtml — Wave 1B", () => {
  const html = compileDesignToHtml(designWave1b, 0);

  it("emits linear-gradient background for rect with gradient", () => {
    expect(html).toMatch(
      /\[data-element-id="00000000-0000-0000-0000-00000000ab21"\]\s*\{[^}]*background:\s*linear-gradient\(90deg,\s*#6bcd06 0%,\s*#fe036d 100%\)/,
    );
  });

  it("emits radial-gradient background for ellipse", () => {
    expect(html).toMatch(
      /\[data-element-id="00000000-0000-0000-0000-00000000ab22"\]\s*\{[^}]*background:\s*radial-gradient\(circle at 50% 50%,\s*#ffffff 0%,\s*#050505 100%\)/,
    );
  });

  it("emits border-radius: 50% for ellipse", () => {
    expect(html).toMatch(
      /\[data-element-id="00000000-0000-0000-0000-00000000ab22"\]\s*\{[^}]*border-radius:\s*50%/,
    );
  });

  it("emits clip-path polygon() for polygon shape with 6 sides", () => {
    expect(html).toMatch(
      /\[data-element-id="00000000-0000-0000-0000-00000000ab24"\]\s*\{[^}]*clip-path:\s*polygon\(/,
    );
  });

  it("emits multi-shadow box-shadow with comma-joined entries", () => {
    // Two shadow entries separated by a comma. The rgba() values each contain
    // commas internally, so we look for both offset+blur prefixes anywhere in
    // the box-shadow value rather than using a comma-anchor regex.
    expect(html).toContain('box-shadow: 4px 4px 12px');
    expect(html).toContain('-4px -4px 12px');
    // Both are in the same CSS rule for element ab21.
    const block = html.match(
      /\[data-element-id="00000000-0000-0000-0000-00000000ab21"\]\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    expect(block).toMatch(/box-shadow:/);
    expect(block).toContain('4px 4px 12px');
    expect(block).toContain('-4px -4px 12px');
  });

  it("emits filter rule with brightness + saturate concatenated", () => {
    expect(html).toMatch(
      /\[data-element-id="00000000-0000-0000-0000-00000000ab21"\]\s*\{[^}]*filter:[^;]*brightness\(1\.1\)[^;]*saturate\(1\.2\)/,
    );
  });

  it("emits contrast + grayscale + sepia + invert functions in filter chain (Gap 1)", () => {
    const block = html.match(
      /\[data-element-id="00000000-0000-0000-0000-00000000ab21"\]\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    expect(block).toMatch(/filter:[^;]*contrast\(120%\)/);
    expect(block).toMatch(/filter:[^;]*grayscale\(30%\)/);
    expect(block).toMatch(/filter:[^;]*sepia\(25%\)/);
    expect(block).toMatch(/filter:[^;]*invert\(10%\)/);
  });

  it("emits text background-clip:text + transparent color for gradient text", () => {
    const block = html.match(
      /\[data-element-id="00000000-0000-0000-0000-00000000ab25"\]\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    expect(block).toMatch(/background-clip:\s*text/);
    expect(block).toMatch(/-webkit-background-clip:\s*text/);
    expect(block).toMatch(/color:\s*transparent/);
  });

  it("renders ellipse/line/polygon as <div> elements with data-element-id", () => {
    expect(html).toContain('data-element-id="00000000-0000-0000-0000-00000000ab22"');
    expect(html).toContain('data-element-id="00000000-0000-0000-0000-00000000ab23"');
    expect(html).toContain('data-element-id="00000000-0000-0000-0000-00000000ab24"');
  });

  it("emits stroke + strokeWidth as border for line element", () => {
    expect(html).toMatch(
      /\[data-element-id="00000000-0000-0000-0000-00000000ab23"\]\s*\{[^}]*background-color:\s*#6bcd06/,
    );
  });
});

describe("compileDesignToHtml — path elements", () => {
  const html = compileDesignToHtml(designWithPath, 0);

  it("emits <svg> inside the path element's <div>", () => {
    expect(html).toMatch(
      /<div[^>]+data-element-id="00000000-0000-0000-0000-000000000400"[^>]*>\s*<svg/,
    );
  });

  it("svg sized to element transform (viewBox + width/height)", () => {
    expect(html).toMatch(/<svg[^>]*viewBox="0 0 400 400"/);
    expect(html).toMatch(/<svg[^>]*width="400"/);
    expect(html).toMatch(/<svg[^>]*height="400"/);
  });

  it("emits a closed cubic-Bezier path with Z terminator", () => {
    expect(html).toMatch(/<path[^>]+d="M 200 0/);
    expect(html).toMatch(/Z"/);
    expect(html).toMatch(/C /);
  });

  it("path inherits fill + stroke from element.style", () => {
    expect(html).toMatch(/<path[^>]+fill="#6bcd06"/);
    expect(html).toMatch(/<path[^>]+stroke="#050505"/);
    expect(html).toMatch(/<path[^>]+stroke-width="4"/);
  });

  it("open path omits the Z terminator", () => {
    const openFixture = JSON.parse(JSON.stringify(designWithPath));
    openFixture.scenes[0].elements[0].content.path.closed = false;
    const openHtml = compileDesignToHtml(openFixture, 0);
    expect(openHtml).not.toMatch(/Z"/);
  });
});

import { designSequence3Scenes } from "./fixtures/design-sequence-3-scenes";

describe("compileDesignToHtml — sequence mode", () => {
  const html = compileDesignToHtml(designSequence3Scenes, 0);

  it("emits a <div data-scene-id> wrapper per scene", () => {
    expect(html).toMatch(/<div\s+data-scene-id="00000000-0000-0000-0000-000000000701"/);
    expect(html).toMatch(/<div\s+data-scene-id="00000000-0000-0000-0000-000000000702"/);
    expect(html).toMatch(/<div\s+data-scene-id="00000000-0000-0000-0000-000000000703"/);
  });

  it("emits per-scene element rules namespaced by data-scene-id", () => {
    expect(html).toMatch(
      /\[data-scene-id="00000000-0000-0000-0000-000000000701"\]\s+\[data-element-id="00000000-0000-0000-0000-000000000801"\]/,
    );
  });

  it("emits the canonical scene transition @keyframes blocks", () => {
    expect(html).toContain("@keyframes scene-fade-in");
    expect(html).toContain("@keyframes scene-fade-out");
    expect(html).toContain("@keyframes scene-slide-left-in");
    expect(html).toContain("@keyframes scene-slide-left-out");
    expect(html).toContain("@keyframes scene-slide-up-in");
    expect(html).toContain("@keyframes scene-slide-up-out");
  });

  it("hides non-active scenes by default (display:none until activated)", () => {
    expect(html).toMatch(
      /\[data-scene-id\]\s*\{[^}]*display:\s*none/,
    );
  });

  it("emits __OVERLAY_SCENES_META__ with id/duration/transition for every scene", () => {
    expect(html).toContain("window.__OVERLAY_SCENES_META__");
    expect(html).toMatch(/id:\s*['"]00000000-0000-0000-0000-000000000701['"]/);
    expect(html).toMatch(/durationMs:\s*5000/);
    expect(html).toMatch(/transitionIn:\s*['"]fade['"]/);
    expect(html).toMatch(/transitionOut:\s*['"]slide-left['"]/);
    expect(html).toMatch(/id:\s*['"]00000000-0000-0000-0000-000000000702['"]/);
    expect(html).toMatch(/durationMs:\s*3000/);
  });

  it("renders text + image content in each scene's elements", () => {
    expect(html).toContain(">MIDDLE<");
    expect(html).toContain("/overlay-user-assets/image/logo-outro.png");
  });

  it("does NOT emit __OVERLAY_SCENES_META__ for single-mode designs", () => {
    // Use a single-mode fixture from Wave 1A. The bootstrap script
    // *references* the symbol (read-only — for runSequence's optional
    // sequence path) so we assert the *assignment* is absent rather
    // than the bare token.
    const singleHtml = compileDesignToHtml(designRectTextImage, 0);
    expect(singleHtml).not.toContain("window.__OVERLAY_SCENES_META__ = [");
  });
});

import { designWithAdvancedTimeline } from "./fixtures/design-with-advanced-timeline";

describe("compileDesignToHtml — Wave 3B advanced timeline", () => {
  it("emits an @keyframes block named builder-<elementId>-entry", () => {
    const html = compileDesignToHtml(designWithAdvancedTimeline, 0);
    expect(html).toMatch(
      /@keyframes\s+builder-00000000-0000-0000-0000-000000003100-entry/,
    );
  });

  it("emits a 0% rule containing opacity:0 AND transform with translateX(-120px)", () => {
    const html = compileDesignToHtml(designWithAdvancedTimeline, 0);
    expect(html).toMatch(/0%\s*\{[^}]*opacity:\s*0\b/);
    expect(html).toMatch(/0%\s*\{[^}]*translate(X|3d)\([^)]*-120/);
  });

  it("emits a 50% rule (mid-timeline) with opacity:1", () => {
    const html = compileDesignToHtml(designWithAdvancedTimeline, 0);
    expect(html).toMatch(/50%\s*\{[^}]*opacity:\s*1\b/);
  });

  it("emits a 100% rule with opacity:0.4 AND translateX(0)", () => {
    const html = compileDesignToHtml(designWithAdvancedTimeline, 0);
    expect(html).toMatch(/100%\s*\{[^}]*opacity:\s*0\.4\b/);
    expect(html).toMatch(/100%\s*\{[^}]*translate(X|3d)\(0/);
  });

  it("emits cubic-bezier(0.4, 0, 0.6, 1) as the segment timing function", () => {
    const html = compileDesignToHtml(designWithAdvancedTimeline, 0);
    expect(html).toMatch(/animation-timing-function:\s*cubic-bezier\(0\.4,\s*0,\s*0\.6,\s*1\)/);
  });

  it("emits an animation: rule referencing the builder-<id>-entry keyframes", () => {
    const html = compileDesignToHtml(designWithAdvancedTimeline, 0);
    expect(html).toMatch(
      /\[data-element-id="00000000-0000-0000-0000-000000003100"\][^{]*\{[^}]*animation:[^;]*builder-00000000-0000-0000-0000-000000003100-entry/,
    );
  });
});
