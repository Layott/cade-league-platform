import { describe, it, expect } from "vitest";
import {
  isValidColor,
  isValidElementId,
  isValidFont,
  isValidEasing,
  isValidAlignment,
  escapeCssValue,
  COLOR_RE,
  ELEMENT_ID_RE,
  EASING_RE,
  FORBIDDEN_CSS_CHARS,
  ALLOWED_KEYFRAMES_PROPS,
  ALIGNMENT_VALUES,
  FONT_FAMILY_ALLOWLIST,
} from "./css-validator";

describe("isValidColor", () => {
  it("accepts 3-digit hex", () => {
    expect(isValidColor("#abc")).toBe(true);
  });

  it("accepts 6-digit hex", () => {
    expect(isValidColor("#fe036d")).toBe(true);
    expect(isValidColor("#FE036D")).toBe(true);
  });

  it("accepts 8-digit hex (with alpha)", () => {
    expect(isValidColor("#6bcd06ff")).toBe(true);
  });

  it("accepts rgba()", () => {
    expect(isValidColor("rgba(254, 3, 109, 0.85)")).toBe(true);
    expect(isValidColor("rgba(0,0,0,1)")).toBe(true);
  });

  it("accepts rgb()", () => {
    expect(isValidColor("rgb(107,205,6)")).toBe(true);
  });

  it("rejects empty / null / undefined", () => {
    expect(isValidColor("")).toBe(false);
    expect(isValidColor(null)).toBe(false);
    expect(isValidColor(undefined)).toBe(false);
  });

  it("rejects bare color names", () => {
    expect(isValidColor("red")).toBe(false);
    expect(isValidColor("transparent")).toBe(false);
  });

  it("rejects values containing CSS metacharacters", () => {
    expect(isValidColor("#fff;display:none")).toBe(false);
    expect(isValidColor("#fff}body{x:y")).toBe(false);
    expect(isValidColor("rgba(0,0,0,1)<script>")).toBe(false);
  });

  it("rejects javascript: URIs", () => {
    expect(isValidColor("javascript:alert(1)")).toBe(false);
  });
});

describe("isValidElementId", () => {
  it("accepts standard kebab-case", () => {
    expect(isValidElementId("title")).toBe(true);
    expect(isValidElementId("partners-strip")).toBe(true);
    expect(isValidElementId("caster-1-name")).toBe(true);
    expect(isValidElementId("match-row-13")).toBe(true);
  });

  it("rejects empty / null / undefined", () => {
    expect(isValidElementId("")).toBe(false);
    expect(isValidElementId(null)).toBe(false);
    expect(isValidElementId(undefined)).toBe(false);
  });

  it("rejects ids starting with a digit or hyphen", () => {
    expect(isValidElementId("1-foo")).toBe(false);
    expect(isValidElementId("-foo")).toBe(false);
  });

  it("rejects uppercase or underscore", () => {
    expect(isValidElementId("Title")).toBe(false);
    expect(isValidElementId("foo_bar")).toBe(false);
  });

  it("rejects ids with spaces or punctuation", () => {
    expect(isValidElementId("my title")).toBe(false);
    expect(isValidElementId("title.")).toBe(false);
    expect(isValidElementId("title;x")).toBe(false);
  });

  it("rejects ids longer than 64 chars", () => {
    expect(isValidElementId("a".repeat(64))).toBe(true);
    expect(isValidElementId("a".repeat(65))).toBe(false);
  });
});

describe("isValidFont", () => {
  it("accepts each brand-locked family", () => {
    for (const f of FONT_FAMILY_ALLOWLIST) {
      expect(isValidFont(f)).toBe(true);
    }
  });

  it("rejects fonts outside the allowlist", () => {
    expect(isValidFont("Helvetica")).toBe(false);
    expect(isValidFont("Comic Sans MS")).toBe(false);
    expect(isValidFont("")).toBe(false);
  });

  it("rejects case mismatches", () => {
    expect(isValidFont("agharti")).toBe(false);
  });
});

describe("isValidEasing", () => {
  it("accepts each preset keyword", () => {
    expect(isValidEasing("linear")).toBe(true);
    expect(isValidEasing("ease")).toBe(true);
    expect(isValidEasing("ease-in")).toBe(true);
    expect(isValidEasing("ease-out")).toBe(true);
    expect(isValidEasing("ease-in-out")).toBe(true);
    expect(isValidEasing("step-start")).toBe(true);
    expect(isValidEasing("step-end")).toBe(true);
  });

  it("accepts cubic-bezier with 4 args", () => {
    expect(isValidEasing("cubic-bezier(0.16, 1, 0.3, 1)")).toBe(true);
    expect(isValidEasing("cubic-bezier(0,0,1,1)")).toBe(true);
    expect(isValidEasing("cubic-bezier(-0.5,1.2,0.3,-0.1)")).toBe(true);
  });

  it("rejects mismatched cubic-bezier args", () => {
    expect(isValidEasing("cubic-bezier(0.16, 1, 0.3)")).toBe(false);
    expect(isValidEasing("cubic-bezier(0.16, 1, 0.3, 1, 5)")).toBe(false);
  });

  it("rejects malicious payloads", () => {
    expect(isValidEasing("ease-out;display:none")).toBe(false);
    expect(isValidEasing("cubic-bezier(0,0,1,1) }")).toBe(false);
    expect(isValidEasing("steps(5)")).toBe(false);
  });
});

describe("isValidAlignment", () => {
  it("accepts each canonical alignment", () => {
    for (const a of ALIGNMENT_VALUES) {
      expect(isValidAlignment(a)).toBe(true);
    }
  });

  it("rejects bare strings", () => {
    expect(isValidAlignment("middle")).toBe(false);
    expect(isValidAlignment("")).toBe(false);
    expect(isValidAlignment("CENTER")).toBe(false);
  });
});

describe("escapeCssValue", () => {
  it("strips CSS metacharacters", () => {
    expect(escapeCssValue("100px;display:none")).toBe("100pxdisplay:none");
    expect(escapeCssValue("#fff}<script>")).toBe("#fffscript");
  });

  it("strips backticks", () => {
    expect(escapeCssValue("foo`bar")).toBe("foobar");
  });

  it("preserves benign values", () => {
    expect(escapeCssValue("100px")).toBe("100px");
    expect(escapeCssValue("center")).toBe("center");
    expect(escapeCssValue("Agharti")).toBe("Agharti");
  });
});

describe("regex constants", () => {
  it("COLOR_RE rejects empty + javascript:", () => {
    expect(COLOR_RE.test("")).toBe(false);
    expect(COLOR_RE.test("javascript:alert(1)")).toBe(false);
  });

  it("ELEMENT_ID_RE matches the spec rule", () => {
    expect(ELEMENT_ID_RE.test("a")).toBe(true);
    expect(ELEMENT_ID_RE.test("a-1")).toBe(true);
    expect(ELEMENT_ID_RE.test("a-1-2-3")).toBe(true);
    expect(ELEMENT_ID_RE.test("9a")).toBe(false);
    expect(ELEMENT_ID_RE.test("a_b")).toBe(false);
  });

  it("EASING_RE rejects steps()", () => {
    expect(EASING_RE.test("steps(4)")).toBe(false);
  });

  it("FORBIDDEN_CSS_CHARS catches the canonical attack chars", () => {
    expect(FORBIDDEN_CSS_CHARS.test(";")).toBe(true);
    expect(FORBIDDEN_CSS_CHARS.test("{")).toBe(true);
    expect(FORBIDDEN_CSS_CHARS.test("}")).toBe(true);
    expect(FORBIDDEN_CSS_CHARS.test("<")).toBe(true);
    expect(FORBIDDEN_CSS_CHARS.test(">")).toBe(true);
    expect(FORBIDDEN_CSS_CHARS.test('"')).toBe(true);
    expect(FORBIDDEN_CSS_CHARS.test("'")).toBe(true);
    expect(FORBIDDEN_CSS_CHARS.test("`")).toBe(true);
    expect(FORBIDDEN_CSS_CHARS.test("a")).toBe(false);
  });

  it("ALLOWED_KEYFRAMES_PROPS contains exactly 9 entries", () => {
    expect(ALLOWED_KEYFRAMES_PROPS.size).toBe(9);
    expect(ALLOWED_KEYFRAMES_PROPS.has("opacity")).toBe(true);
    expect(ALLOWED_KEYFRAMES_PROPS.has("transform")).toBe(true);
    expect(ALLOWED_KEYFRAMES_PROPS.has("filter")).toBe(true);
    expect(ALLOWED_KEYFRAMES_PROPS.has("letter-spacing")).toBe(true);
    expect(ALLOWED_KEYFRAMES_PROPS.has("color")).toBe(true);
    expect(ALLOWED_KEYFRAMES_PROPS.has("background-color")).toBe(true);
    expect(ALLOWED_KEYFRAMES_PROPS.has("border-color")).toBe(true);
    expect(ALLOWED_KEYFRAMES_PROPS.has("text-shadow")).toBe(true);
    expect(ALLOWED_KEYFRAMES_PROPS.has("box-shadow")).toBe(true);
    expect(ALLOWED_KEYFRAMES_PROPS.has("width")).toBe(false);
    expect(ALLOWED_KEYFRAMES_PROPS.has("display")).toBe(false);
  });
});
