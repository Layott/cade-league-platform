import { describe, it, expect } from "vitest";
import { slugify, stripDiacritics } from "./slug";

describe("stripDiacritics", () => {
  it("removes combining marks (Pépé → Pepe)", () => {
    expect(stripDiacritics("Pépé")).toBe("Pepe");
  });

  it("preserves ASCII as-is", () => {
    expect(stripDiacritics("Lionel Messi")).toBe("Lionel Messi");
  });

  it("handles multiple diacritics in one string (Müller, Özil)", () => {
    expect(stripDiacritics("Müller")).toBe("Muller");
    expect(stripDiacritics("Özil")).toBe("Ozil");
  });
});

describe("slugify", () => {
  it("lowercases + spaces → single underscore", () => {
    expect(slugify("Lionel Messi")).toBe("lionel_messi");
  });

  it("strips diacritics (Pépé → pepe)", () => {
    expect(slugify("Pépé")).toBe("pepe");
  });

  it("collapses non-alphanumeric runs to one underscore", () => {
    expect(slugify("O'Connor")).toBe("o_connor");
    expect(slugify("Saint-Maximin")).toBe("saint_maximin");
  });

  it("trims leading/trailing underscores", () => {
    expect(slugify("  hello  ")).toBe("hello");
    expect(slugify("--hello--")).toBe("hello");
  });

  it("collapses multiple spaces to single underscore", () => {
    expect(slugify("De   Bruyne")).toBe("de_bruyne");
  });

  it("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
  });

  it("matches Python importer for typical FC names", () => {
    // Locked contract — both implementations must produce these slugs so the
    // ref-review lookup in lookup.ts hits the same row the importer wrote.
    expect(slugify("Kylian Mbappé")).toBe("kylian_mbappe");
    expect(slugify("Erling Haaland")).toBe("erling_haaland");
    expect(slugify("Vinícius Jr.")).toBe("vinicius_jr");
  });
});
