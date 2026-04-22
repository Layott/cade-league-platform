import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseKaggleCsv, tryKaggleRefresh } from "./kaggle";

describe("parseKaggleCsv", () => {
  it("parses the canonical flynn28 schema", () => {
    const csv = [
      "id,name,overall,position,club_name,league_name,nationality_name,value_eur,item_type,alt_positions",
      '158023,"Lionel Messi",94,CAM,"Inter Miami",MLS,Argentina,15000000,rare_gold,"RW,CF"',
      '20801,"Cristiano Ronaldo",88,ST,"Al-Nassr","Saudi Pro League",Portugal,10000000,gold,',
    ].join("\n");
    const rows = parseKaggleCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      source_dataset: expect.stringContaining("kaggle.com"),
      source_row_id: "158023",
      name: "Lionel Messi",
      slug: "lionel_messi",
      rating: 94,
      position: "CAM",
      alt_positions: ["RW", "CF"],
      club: "Inter Miami",
      league: "MLS",
      nation: "Argentina",
      value_coins_estimate: 15000000,
    });
    expect(rows[1].alt_positions).toBeNull();
  });

  it("skips rows missing name/id/rating", () => {
    const csv = [
      "id,name,overall,position",
      ",NoId,90,ST",
      "1,,85,ST",
      "2,OK,,ST",
      "3,Valid,88,ST",
    ].join("\n");
    const rows = parseKaggleCsv(csv);
    expect(rows.map((r) => r.source_row_id)).toEqual(["3"]);
  });
});

describe("tryKaggleRefresh", () => {
  const origToken = process.env.KAGGLE_API_TOKEN;
  const origKey = process.env.KAGGLE_KEY;
  const origUser = process.env.KAGGLE_USERNAME;

  beforeEach(() => {
    delete process.env.KAGGLE_API_TOKEN;
    delete process.env.KAGGLE_KEY;
    delete process.env.KAGGLE_USERNAME;
  });
  afterEach(() => {
    if (origToken) process.env.KAGGLE_API_TOKEN = origToken;
    if (origKey) process.env.KAGGLE_KEY = origKey;
    if (origUser) process.env.KAGGLE_USERNAME = origUser;
  });

  it("returns skipped when no kaggle token env is set", async () => {
    const out = await tryKaggleRefresh();
    expect(out).toEqual({
      skipped: true,
      source: "kaggle",
      reason: expect.stringContaining("KAGGLE"),
    });
  });

  it("returns skipped when CLI is not on PATH even if token is set", async () => {
    process.env.KAGGLE_API_TOKEN = "t";
    const out = await tryKaggleRefresh({
      whichImpl: async () => false,
    });
    expect(out).toEqual({
      skipped: true,
      source: "kaggle",
      reason: expect.stringContaining("not on PATH"),
    });
  });
});
