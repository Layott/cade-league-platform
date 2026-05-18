/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "a" } } }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "u" }, error: null }),
    })),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceRoleSupabase: vi.fn(() => ({ __svc: true })),
}));
vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: vi.fn().mockResolvedValue(undefined),
  PermissionError: class PermissionError extends Error {},
}));
vi.mock("@/server/overlays/builder/photopea-signed-url", () => ({
  mintPsdSignedUrl: vi.fn().mockResolvedValue("https://signed.example"),
}));
vi.mock(
  "@/components/admin/broadcast/v2/builder/PhotopeaIframe",
  () => ({
    PhotopeaIframe: (props: Record<string, unknown>) => (
      <div data-testid="photopea-iframe-mock">
        {JSON.stringify({
          assetId: props.assetId,
          psdSignedUrl: props.psdSignedUrl,
        })}
      </div>
    ),
  }),
);

describe("PSD page server component", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED = "true";
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED = "true";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED;
    delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED;
  });

  it("renders the PhotopeaIframe when both flags are on and assetId valid", async () => {
    const { default: Page } = await import("./page");
    const node = await Page({
      params: Promise.resolve({ slug: "test-design" }),
      searchParams: Promise.resolve({
        assetId: "11111111-1111-4111-8111-111111111111",
      }),
    });
    render(node);
    const mock = screen.getByTestId("photopea-iframe-mock");
    expect(mock.textContent).toContain(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(mock.textContent).toContain("https://signed.example");
  });

  it("returns notFound when photopea flag is off", async () => {
    process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED = "false";
    vi.resetModules();
    const { default: Page } = await import("./page");
    await expect(
      Page({
        params: Promise.resolve({ slug: "test-design" }),
        searchParams: Promise.resolve({
          assetId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    ).rejects.toThrow(/NEXT_NOT_FOUND/);
  });

  it("returns notFound when assetId search param is missing", async () => {
    const { default: Page } = await import("./page");
    await expect(
      Page({
        params: Promise.resolve({ slug: "test-design" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(/NEXT_NOT_FOUND/);
  });

  it("returns notFound when assetId is not a uuid", async () => {
    const { default: Page } = await import("./page");
    await expect(
      Page({
        params: Promise.resolve({ slug: "test-design" }),
        searchParams: Promise.resolve({ assetId: "not-a-uuid" }),
      }),
    ).rejects.toThrow(/NEXT_NOT_FOUND/);
  });
});
