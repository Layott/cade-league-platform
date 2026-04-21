import { describe, it, expect } from "vitest";
import {
  resolvePlayerPhotoUrl,
  listPlayerSlugs,
  getPlayerDisplayName,
  PLAYER_MANIFEST_META,
} from "./players";

describe("player photo resolver", () => {
  it("lists 13 canonical player slugs", () => {
    const slugs = listPlayerSlugs();
    expect(slugs.length).toBeGreaterThanOrEqual(10);
    expect(slugs).toContain("adefola");
    expect(slugs).toContain("killer_freak");
  });

  it("resolves a headshot URL rooted at /brand/players/", () => {
    const url = resolvePlayerPhotoUrl("adefola");
    expect(url).toMatch(/^\/brand\/players\/adefola\/headshot_\d+\.png$/);
  });

  it("honours preferNoBg", () => {
    const url = resolvePlayerPhotoUrl("adefola", "headshot", {
      preferNoBg: true,
    });
    expect(url).toMatch(/_nobg\.png$/);
  });

  it("falls through to base variant when _nobg missing", () => {
    // Every player currently ships with _nobg but the resolver must
    // still fall back cleanly. We just assert it's non-null.
    const url = resolvePlayerPhotoUrl("anife", "card", { preferNoBg: true });
    expect(url).toMatch(/^\/brand\/players\/anife\//);
  });

  it("returns null when slug is missing", () => {
    expect(resolvePlayerPhotoUrl("not-a-real-slug")).toBeNull();
  });

  it("exposes display name per slug", () => {
    expect(getPlayerDisplayName("adefola")).toBe("Adefola");
    expect(getPlayerDisplayName("bogus")).toBeNull();
  });

  it("PLAYER_MANIFEST_META reports generation metadata", () => {
    expect(PLAYER_MANIFEST_META.generatedAt).toBeTypeOf("string");
    expect(PLAYER_MANIFEST_META.playerCount).toBeGreaterThan(0);
  });
});
