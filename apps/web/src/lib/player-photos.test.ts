import { describe, it, expect } from "vitest";
import {
  gamerTagToSlug,
  getPlayerHeadshotUrl,
  getPlayerAvatarUrl,
  knownPlayerSlugs,
} from "./player-photos";

describe("gamerTagToSlug", () => {
  it("lowercases and collapses spaces to underscores", () => {
    expect(gamerTagToSlug("Killer Freak")).toBe("killer_freak");
    expect(gamerTagToSlug("Mr Oga")).toBe("mr_oga");
    expect(gamerTagToSlug("Baji Jnr")).toBe("baji_jnr");
  });

  it("trims surrounding whitespace", () => {
    expect(gamerTagToSlug("  Adefola  ")).toBe("adefola");
  });

  it("collapses hyphens to underscores", () => {
    expect(gamerTagToSlug("dada-boi")).toBe("dada_boi");
  });

  it("strips punctuation", () => {
    expect(gamerTagToSlug("Mr. Oga!")).toBe("mr_oga");
  });
});

describe("getPlayerHeadshotUrl", () => {
  it("returns the pose-1 v2 _nobg headshot for a known gamer tag", () => {
    // B6 update (2026-04-28): canonical photo path is the v2 _assets
    // tree so every overlay resolves photos from the same place.
    expect(getPlayerHeadshotUrl("Adefola")).toBe(
      "/overlays/v2/_assets/players/processed/adefola/headshot_01_nobg.png",
    );
  });

  it("returns the v2 _nobg path for the transparent variant", () => {
    expect(getPlayerHeadshotUrl("Adefola", "transparent")).toBe(
      "/overlays/v2/_assets/players/processed/adefola/headshot_01_nobg.png",
    );
  });

  it("returns the requested pose index padded to 2 digits", () => {
    expect(getPlayerHeadshotUrl("Anife", "normal", 3)).toBe(
      "/overlays/v2/_assets/players/processed/anife/headshot_03_nobg.png",
    );
  });

  it("normalises tags with spaces and casing", () => {
    expect(getPlayerHeadshotUrl("KILLER FREAK")).toBe(
      "/overlays/v2/_assets/players/processed/killer_freak/headshot_01_nobg.png",
    );
    expect(getPlayerHeadshotUrl("mr oga")).toBe(
      "/overlays/v2/_assets/players/processed/mr_oga/headshot_01_nobg.png",
    );
  });

  it("returns null for unknown players", () => {
    expect(getPlayerHeadshotUrl("Stranger Danger")).toBeNull();
  });

  it("returns null for missing pose index", () => {
    // adefola only has 3 poses
    expect(getPlayerHeadshotUrl("Adefola", "normal", 99)).toBeNull();
  });

  it("returns null for empty / null input", () => {
    expect(getPlayerHeadshotUrl(null)).toBeNull();
    expect(getPlayerHeadshotUrl(undefined)).toBeNull();
    expect(getPlayerHeadshotUrl("")).toBeNull();
  });

  it("honours per-slug DEFAULT_POSE_BY_SLUG override when poseIndex is not specified", () => {
    // Anife pose_01 = hands-covering-mouth (BANNED). Default falls
    // through to pose 5.
    expect(getPlayerHeadshotUrl("Anife")).toBe(
      "/overlays/v2/_assets/players/processed/anife/headshot_05_nobg.png",
    );
    // KingNonex pose_01 = back-of-jersey (BANNED). Default falls
    // through to pose 2.
    expect(getPlayerHeadshotUrl("KINGNONEX")).toBe(
      "/overlays/v2/_assets/players/processed/kingnonex/headshot_02_nobg.png",
    );
  });

  it("explicit poseIndex caller arg overrides DEFAULT_POSE_BY_SLUG", () => {
    // If a caller still wants pose 01 for Anife it can ask for it.
    expect(getPlayerHeadshotUrl("Anife", "normal", 1)).toBe(
      "/overlays/v2/_assets/players/processed/anife/headshot_01_nobg.png",
    );
  });
});

describe("getPlayerAvatarUrl", () => {
  it("delegates to default pose v2 _nobg headshot for players without override", () => {
    expect(getPlayerAvatarUrl("Tactical")).toBe(
      "/overlays/v2/_assets/players/processed/tactical/headshot_01_nobg.png",
    );
  });

  it("honours per-slug pose override (banned poses don't leak into row UIs)", () => {
    expect(getPlayerAvatarUrl("Anife")).toBe(
      "/overlays/v2/_assets/players/processed/anife/headshot_05_nobg.png",
    );
    expect(getPlayerAvatarUrl("KINGNONEX")).toBe(
      "/overlays/v2/_assets/players/processed/kingnonex/headshot_02_nobg.png",
    );
  });

  it("returns null for unknown player", () => {
    expect(getPlayerAvatarUrl("Nobody")).toBeNull();
  });
});

describe("knownPlayerSlugs", () => {
  it("includes the seeded 13-roster slugs", () => {
    const slugs = knownPlayerSlugs();
    expect(slugs).toContain("adefola");
    expect(slugs).toContain("baji_jnr");
    expect(slugs).toContain("killer_freak");
    expect(slugs).toContain("mr_oga");
    expect(slugs).toContain("wolevation");
    expect(slugs.length).toBeGreaterThanOrEqual(13);
  });
});
