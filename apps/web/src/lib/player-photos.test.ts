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
  it("returns the pose-1 normal headshot for a known gamer tag", () => {
    expect(getPlayerHeadshotUrl("Adefola")).toBe(
      "/players/adefola/headshot_01.png",
    );
  });

  it("returns a real PNG for the transparent variant (currently same as normal)", () => {
    // Plan 22's `_nobg` pipeline isn't shipped yet — both variants resolve
    // to the existing `headshot_<NN>.png` which is already transparent.
    // Lock the contract: the URL must point at a real file under /public.
    expect(getPlayerHeadshotUrl("Adefola", "transparent")).toBe(
      "/players/adefola/headshot_01.png",
    );
  });

  it("returns the requested pose index when present", () => {
    expect(getPlayerHeadshotUrl("Anife", "normal", 3)).toBe(
      "/players/anife/headshot_03.png",
    );
  });

  it("normalises tags with spaces and casing", () => {
    expect(getPlayerHeadshotUrl("KILLER FREAK")).toBe(
      "/players/killer_freak/headshot_01.png",
    );
    expect(getPlayerHeadshotUrl("mr oga")).toBe(
      "/players/mr_oga/headshot_01.png",
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
});

describe("getPlayerAvatarUrl", () => {
  it("delegates to pose-1 normal headshot", () => {
    expect(getPlayerAvatarUrl("Tactical")).toBe(
      "/players/tactical/headshot_01.png",
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
