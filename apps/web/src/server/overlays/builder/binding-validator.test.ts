import { describe, expect, it } from "vitest";
import { validateBinding } from "./binding-validator";
import type { FeedName } from "./types";

const ALL_FEEDS: FeedName[] = [
  "standings",
  "live_score",
  "top_scorers",
  "h2h",
  "match",
  "match_day",
  "custom_text",
];

describe("validateBinding — accepts valid bindings", () => {
  it("standings rank-1 name", () => {
    const r = validateBinding(
      { feed: "standings", fieldPath: "[0].name" },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(true);
  });

  it("live_score home name (snake_case path)", () => {
    const r = validateBinding(
      { feed: "live_score", fieldPath: "home_name" },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(true);
  });

  it("top_scorers first photoUrl through array index", () => {
    const r = validateBinding(
      { feed: "top_scorers", fieldPath: "[0].photoUrl" },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(true);
  });

  it("h2h nested win prob (dot path with camelCase)", () => {
    const r = validateBinding(
      { feed: "h2h", fieldPath: "playerA.winProbPct" },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(true);
  });

  it("templateString with one interpolation", () => {
    const r = validateBinding(
      {
        feed: "standings",
        fieldPath: "[0].name",
        templateString: "${standings[0].name}",
      },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(true);
  });

  it("templateString with literal text + interpolation + literal text", () => {
    const r = validateBinding(
      {
        feed: "standings",
        fieldPath: "[0].points",
        templateString: "RANK 1 — ${standings[0].name} (${standings[0].points} pts)",
      },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(true);
  });

  it("templateString with NO interpolations (plain text)", () => {
    const r = validateBinding(
      {
        feed: "custom_text",
        fieldPath: "value",
        templateString: "Halftime",
      },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(true);
  });

  it("templateString with leading $ that is not interpolation", () => {
    const r = validateBinding(
      {
        feed: "custom_text",
        fieldPath: "value",
        templateString: "$10 prize ${custom_text.value}",
      },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(true);
  });
});

describe("validateBinding — rejects malformed bindings", () => {
  it("rejects ${eval(...)} expression inside template", () => {
    const r = validateBinding(
      {
        feed: "custom_text",
        fieldPath: "value",
        templateString: "${eval(alert(1))}",
      },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects ${fn()} method call inside template", () => {
    const r = validateBinding(
      {
        feed: "standings",
        fieldPath: "[0].name",
        templateString: "${standings[0].name()}",
      },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects arithmetic ${a+b} inside template", () => {
    const r = validateBinding(
      {
        feed: "standings",
        fieldPath: "[0].name",
        templateString: "${a+b}",
      },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects feed not in availableFeeds", () => {
    const r = validateBinding(
      { feed: "secret_internal" as unknown as FeedName, fieldPath: "x" },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects fieldPath with operators", () => {
    const r = validateBinding(
      { feed: "standings", fieldPath: "[0].name+evil" },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects templateString with unbalanced ${ braces", () => {
    const r = validateBinding(
      {
        feed: "standings",
        fieldPath: "[0].name",
        templateString: "${standings[0].name",
      },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects Unicode escape attempt inside templateString", () => {
    const r = validateBinding(
      {
        feed: "standings",
        fieldPath: "[0].name",
        templateString: "${stand\\u0069ngs[0].name}",
      },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects SQL-style ;DROP injection in templateString", () => {
    const r = validateBinding(
      {
        feed: "custom_text",
        fieldPath: "value",
        templateString: "${custom_text.value};DROP TABLE users",
      },
      ALL_FEEDS,
    );
    expect(r.ok).toBe(false);
  });
});
