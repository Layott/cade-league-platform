import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";

/**
 * Phase 3 — SSR token-injection snapshot test.
 *
 * The overlay route must emit a `<style>` tag with `:root{ --overlay-X: …}`
 * BEFORE the OverlayDataInjector. When the DB has no token rows, the
 * style block contains the hard-coded BASE_DEFAULTS for the overlay key.
 * When ?previewTokens=… is present, a second style block (`#preview-
 * tokens`) is rendered higher in the cascade.
 */

const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    const e = new Error(`NEXT_REDIRECT;${url}`);
    (e as unknown as { digest: string }).digest = `NEXT_REDIRECT;replace;${url};303`;
    throw e;
  }),
);
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

vi.mock("@/components/broadcast/v2/OverlayDataInjector", () => ({
  default: () =>
    React.createElement("div", { "data-testid": "overlay-injector" }),
}));

const serviceClientMock = vi.hoisted(() => ({}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceRoleSupabase: () => serviceClientMock,
}));

vi.mock("@/server/broadcast/active_session", () => ({
  getActiveSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/server/broadcast/v2/overlay_active_state", () => ({
  isOverlayActive: vi.fn().mockResolvedValue(false),
}));

const resolveTokensMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    "bg-color": "#050505",
    "accent-color": "#6bcd06",
    "text-color": "#ffffff",
    "font-display": "Agharti",
    "font-body": "Quedora",
  }),
);
vi.mock("@/server/overlays/design/tokens", () => ({
  resolveTokens: resolveTokensMock,
}));

const getActiveTemplateVariantMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    id: "v-1",
    overlayKey: "01-brb",
    variantId: "default",
    label: "default",
    description: null,
    htmlPath: "apps/web/public/overlays/v2/01-brb/index.html",
    thumbnailPath: null,
    active: true,
  }),
);
vi.mock("@/server/overlays/design/templates", () => ({
  getActiveTemplateVariant: getActiveTemplateVariantMock,
}));

// Wave 2 Stage 2 — overlay route now resolves text-element overrides
// alongside the design tokens. Mock to empty so the existing token
// snapshot tests don't crash when the resolver hits the (mocked) sb.
const resolveTextElementsMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({}),
);
vi.mock("@/server/overlays/text/elements", () => ({
  resolveTextElements: resolveTextElementsMock,
}));

import OverlayV2Page from "./page";

beforeEach(() => {
  redirectMock.mockClear();
  resolveTokensMock.mockClear();
  getActiveTemplateVariantMock.mockClear();
  resolveTextElementsMock.mockClear();
});

/** Render the React tree to a flat string of element tags + props text. */
function flatten(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flatten).join("");
  if (
    typeof node === "object" &&
    node &&
    "props" in (node as object)
  ) {
    const el = node as { type: unknown; props: Record<string, unknown> };
    const tag =
      typeof el.type === "string"
        ? el.type
        : typeof el.type === "function"
          ? (el.type as { displayName?: string; name?: string }).displayName ??
            (el.type as { name?: string }).name ??
            "fn"
          : "?";
    const propsRender = Object.entries(el.props ?? {})
      .map(([k, v]) => {
        if (k === "children") return "";
        if (
          k === "dangerouslySetInnerHTML" &&
          v &&
          typeof v === "object" &&
          "__html" in (v as Record<string, unknown>)
        ) {
          return ` ${k}=${(v as { __html: string }).__html}`;
        }
        return ` ${k}=${typeof v === "string" ? v : JSON.stringify(v)}`;
      })
      .join("");
    const children = flatten((el.props as { children?: unknown }).children);
    return `<${tag}${propsRender}>${children}</${tag}>`;
  }
  return "";
}

describe("OverlayV2Page — SSR token injection", () => {
  it("emits :root CSS variables for an overlay with default tokens", async () => {
    const tree = await OverlayV2Page({
      params: Promise.resolve({ key: "01-brb" }),
      searchParams: Promise.resolve({}),
    });
    const html = flatten(tree);
    expect(html).toContain("--overlay-bg-color: #050505");
    expect(html).toContain("--overlay-accent-color: #6bcd06");
  });

  it("emits a #preview-tokens block when previewTokens param is supplied", async () => {
    // Build a valid base64 payload: { "accent-color": "#fe036d" }
    const payload = Buffer.from(
      JSON.stringify({ "accent-color": "#fe036d" }),
      "utf-8",
    )
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const tree = await OverlayV2Page({
      params: Promise.resolve({ key: "01-brb" }),
      searchParams: Promise.resolve({ previewTokens: payload }),
    });
    const html = flatten(tree);
    expect(html).toContain("preview-tokens");
    expect(html).toContain("#fe036d");
  });

  it("redirects unknown keys instead of crashing", async () => {
    await expect(
      OverlayV2Page({
        params: Promise.resolve({ key: "this-overlay-does-not-exist" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalled();
  });
});
