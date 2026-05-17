import { describe, expect, it } from "vitest";
import { BOOTSTRAP_SCRIPT } from "./bootstrap-template";

describe("BOOTSTRAP_SCRIPT", () => {
  it("contains a postMessage listener on window", () => {
    expect(BOOTSTRAP_SCRIPT).toMatch(/addEventListener\s*\(\s*['"]message['"]/);
  });

  it("handles show / hide / update envelope types", () => {
    expect(BOOTSTRAP_SCRIPT).toMatch(/['"]show['"]/);
    expect(BOOTSTRAP_SCRIPT).toMatch(/['"]hide['"]/);
    expect(BOOTSTRAP_SCRIPT).toMatch(/['"]update['"]/);
  });

  it("adds cade-visible class on show", () => {
    expect(BOOTSTRAP_SCRIPT).toMatch(/cade-visible/);
  });

  it("swaps to cade-exiting on hide", () => {
    expect(BOOTSTRAP_SCRIPT).toMatch(/cade-exiting/);
  });

  it("tags the observer script with cade-visible-gate-observer-v2", () => {
    expect(BOOTSTRAP_SCRIPT).toMatch(/cade-visible-gate-observer-v2/);
  });

  it("contains a MutationObserver on document.body class attribute", () => {
    expect(BOOTSTRAP_SCRIPT).toMatch(/MutationObserver/);
    expect(BOOTSTRAP_SCRIPT).toMatch(/attributeFilter/);
  });

  it("guards the demo loop behind ?demo=1", () => {
    expect(BOOTSTRAP_SCRIPT).toMatch(/URLSearchParams/);
    expect(BOOTSTRAP_SCRIPT).toMatch(/demo/);
    expect(BOOTSTRAP_SCRIPT).toMatch(/setTimeout/);
  });

  it("exposes a __cadeBuilderRuntime global for the per-design feed hook", () => {
    expect(BOOTSTRAP_SCRIPT).toMatch(/__cadeBuilderRuntime/);
  });

  it("references INITIAL_FETCH_PATH and REALTIME_KEY_EVENTS marker names", () => {
    expect(BOOTSTRAP_SCRIPT).toMatch(/INITIAL_FETCH_PATH/);
    expect(BOOTSTRAP_SCRIPT).toMatch(/REALTIME_KEY_EVENTS/);
  });

  it("is wrapped in an IIFE so globals do not leak", () => {
    expect(BOOTSTRAP_SCRIPT).toMatch(/\(function\s*\(\s*\)\s*\{[\s\S]+\}\)\s*\(\s*\)/);
  });

  it("is reasonably sized (kilobytes, not megabytes)", () => {
    expect(BOOTSTRAP_SCRIPT.length).toBeGreaterThan(500);
    expect(BOOTSTRAP_SCRIPT.length).toBeLessThan(20000);
  });
});
