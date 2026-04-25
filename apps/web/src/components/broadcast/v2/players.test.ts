import { describe, it, expect } from "vitest";
import {
  V2_PLAYER_SLUGS,
  V2_PLAYER_NAMES,
  v2PlayerLabel,
} from "./players";

describe("V2_PLAYER_SLUGS", () => {
  it("contains the 13 Elite roster slugs", () => {
    expect(V2_PLAYER_SLUGS.length).toBe(13);
  });

  it("every slug has an upper-case display name", () => {
    for (const s of V2_PLAYER_SLUGS) {
      const label = V2_PLAYER_NAMES[s];
      expect(label).toBeTruthy();
      expect(label).toBe(label.toUpperCase());
    }
  });

  it("includes ADEFOLA, ANIFE, MR OGA per repo state", () => {
    expect(V2_PLAYER_NAMES.adefola).toBe("ADEFOLA");
    expect(V2_PLAYER_NAMES.anife).toBe("ANIFE");
    expect(V2_PLAYER_NAMES.mr_oga).toBe("MR OGA");
  });
});

describe("v2PlayerLabel()", () => {
  it("maps a known slug to its display name", () => {
    expect(v2PlayerLabel("faruk")).toBe("FARUK");
  });

  it("falls back to upper-case for unknown slugs", () => {
    expect(v2PlayerLabel("ghost")).toBe("GHOST");
  });
});
