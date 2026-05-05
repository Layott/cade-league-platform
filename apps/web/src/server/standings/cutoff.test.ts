import { describe, it, expect } from "vitest";
import { selectMatchesThroughCutoff, type MatchInOrder } from "./cutoff";

const M = (
  id: string,
  match_day_id: string,
  match_date: string,
  match_order: number,
  home_player_id = "p-h",
  away_player_id = "p-a",
): MatchInOrder => ({
  id,
  match_day_id,
  match_date,
  match_order,
  home_player_id,
  away_player_id,
});

describe("selectMatchesThroughCutoff — matchday cutoff", () => {
  const ordered: MatchInOrder[] = [
    M("m1", "md1", "2026-05-01", 1),
    M("m2", "md1", "2026-05-01", 2),
    M("m3", "md2", "2026-05-08", 1),
    M("m4", "md2", "2026-05-08", 2),
    M("m5", "md3", "2026-05-15", 1),
  ];

  it("includes all matches in earlier matchdays + target matchday", () => {
    const got = selectMatchesThroughCutoff(ordered, { type: "matchday", matchDayId: "md2" });
    expect(got.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("includes only first matchday when target is the first", () => {
    const got = selectMatchesThroughCutoff(ordered, { type: "matchday", matchDayId: "md1" });
    expect(got.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("includes everything when target is the last", () => {
    const got = selectMatchesThroughCutoff(ordered, { type: "matchday", matchDayId: "md3" });
    expect(got.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  });

  it("returns empty array when matchday id is unknown", () => {
    const got = selectMatchesThroughCutoff(ordered, { type: "matchday", matchDayId: "nope" });
    expect(got).toEqual([]);
  });
});

describe("selectMatchesThroughCutoff — matchday-only cutoff", () => {
  const ordered: MatchInOrder[] = [
    M("m1", "md1", "2026-05-01", 1),
    M("m2", "md1", "2026-05-01", 2),
    M("m3", "md2", "2026-05-08", 1),
    M("m4", "md2", "2026-05-08", 2),
    M("m5", "md3", "2026-05-15", 1),
  ];

  it("returns only matches in target matchday (middle MD)", () => {
    const got = selectMatchesThroughCutoff(ordered, {
      type: "matchday-only",
      matchDayId: "md2",
    });
    expect(got.map((m) => m.id)).toEqual(["m3", "m4"]);
  });

  it("returns only target MD's matches when target is first MD", () => {
    const got = selectMatchesThroughCutoff(ordered, {
      type: "matchday-only",
      matchDayId: "md1",
    });
    expect(got.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("returns empty array when matchday id is unknown", () => {
    const got = selectMatchesThroughCutoff(ordered, {
      type: "matchday-only",
      matchDayId: "nope",
    });
    expect(got).toEqual([]);
  });
});

describe("selectMatchesThroughCutoff — match cutoff", () => {
  const ordered: MatchInOrder[] = [
    M("m1", "md1", "2026-05-01", 1),
    M("m2", "md1", "2026-05-01", 2),
    M("m3", "md2", "2026-05-08", 1),
    M("m4", "md2", "2026-05-08", 2),
    M("m5", "md3", "2026-05-15", 1),
  ];

  it("includes target match + all earlier matches across earlier matchdays", () => {
    const got = selectMatchesThroughCutoff(ordered, { type: "match", matchId: "m4" });
    expect(got.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("includes only target match when it is the very first", () => {
    const got = selectMatchesThroughCutoff(ordered, { type: "match", matchId: "m1" });
    expect(got.map((m) => m.id)).toEqual(["m1"]);
  });

  it("includes earlier match in same matchday but not later one", () => {
    const got = selectMatchesThroughCutoff(ordered, { type: "match", matchId: "m3" });
    expect(got.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("returns empty array when match id is unknown", () => {
    const got = selectMatchesThroughCutoff(ordered, { type: "match", matchId: "nope" });
    expect(got).toEqual([]);
  });
});
