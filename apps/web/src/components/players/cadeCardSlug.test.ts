import { describe, it, expect } from "vitest";
import { slugFromDisplayName, publicHeadshotUrl } from "./cadeCardSlug";

describe("slugFromDisplayName", () => {
  it("lowercases single names", () => {
    expect(slugFromDisplayName("Adefola")).toBe("adefola");
  });

  it("collapses spaces to underscores", () => {
    expect(slugFromDisplayName("Baji Jnr")).toBe("baji_jnr");
    expect(slugFromDisplayName("Killer Freak")).toBe("killer_freak");
    expect(slugFromDisplayName("Mr Oga")).toBe("mr_oga");
  });

  it("strips punctuation + double spaces", () => {
    expect(slugFromDisplayName("  King-Nonex  ")).toBe("king_nonex");
  });
});

describe("publicHeadshotUrl", () => {
  it("defaults to pose 01", () => {
    expect(publicHeadshotUrl("adefola")).toBe("/players/adefola/headshot_01.png");
  });

  it("zero-pads pose index", () => {
    expect(publicHeadshotUrl("anife", 5)).toBe("/players/anife/headshot_05.png");
  });
});
