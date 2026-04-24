import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const upsert = require("../../../../../KNOWLEDGE/extracted/_lib_diff_upsert");

/**
 * Guard against the 12,931-row coverage regression surfaced on 2026-04-23.
 *
 * Before this test existed: when a re-scrape captured `cardBgUrl` for a row
 * that previously lacked it, but no other field (price, stats, image,
 * variant) had changed, `diffFields()` returned `[]`, the diff-upsert
 * labelled the row "unchanged", and the UPDATE was skipped — so the new
 * `card_bg_url` never landed in the DB and the picker kept rendering a
 * black rectangle.
 *
 * After: `diffFields` now compares `card_bg_url`, so a pure-bg change
 * triggers an UPDATE. Combined with the broadened DOM selector (86e4aba +
 * this commit), every re-scraped silver/bronze row will now end up with
 * its frame populated.
 */
describe("_lib_diff_upsert.diffFields — card_bg_url awareness", () => {
  const oldRow = {
    value_coins_estimate: 1000,
    item_type: "normal",
    attributes: {
      card_image_url: "https://cdn3.futbin.com/content/fifa26/img/players/123.png",
      futbin_variant: "0-silver",
      mains: { pac: 70, sho: 60, pas: 65, dri: 70, def: 60, phy: 60 },
      platform_prices: { ps: 1000, pc: 1000 },
      // card_bg_url ABSENT — this is the key state the silvers/bronzes
      // were stuck in after the revert pass on 2026-04-23.
    },
  };
  const newCoins = 1000;
  const newItemType = "normal";

  it("returns 'card_bg' when an existing row gains a newly-captured card_bg_url", () => {
    const newAttrs = {
      ...oldRow.attributes,
      card_bg_url:
        "https://cdn3.futbin.com/content/fifa26/img/cards/tiny/0_silver.png?fm=png&ixlib=java-2.1.0&s=abc123",
    };
    const changes = upsert.diffFields(oldRow, newCoins, newItemType, newAttrs);
    expect(changes).toContain("card_bg");
  });

  it("does NOT return 'card_bg' when the card_bg_url is unchanged", () => {
    const withBg = {
      ...oldRow,
      attributes: {
        ...oldRow.attributes,
        card_bg_url: "https://cdn3.futbin.com/content/fifa26/img/cards/tiny/0_silver.png?s=abc",
      },
    };
    const newAttrs = { ...withBg.attributes };
    const changes = upsert.diffFields(withBg, newCoins, newItemType, newAttrs);
    expect(changes).not.toContain("card_bg");
  });

  it("returns 'card_bg' when the stored URL's HMAC signature shifts (Futbin rotates signatures)", () => {
    const withBg = {
      ...oldRow,
      attributes: {
        ...oldRow.attributes,
        card_bg_url: "https://cdn3.futbin.com/content/fifa26/img/cards/tiny/0_silver.png?s=OLD",
      },
    };
    const newAttrs = {
      ...withBg.attributes,
      card_bg_url: "https://cdn3.futbin.com/content/fifa26/img/cards/tiny/0_silver.png?s=NEW",
    };
    const changes = upsert.diffFields(withBg, newCoins, newItemType, newAttrs);
    expect(changes).toContain("card_bg");
  });

  it("still returns empty when literally nothing changed (no noise writes)", () => {
    const withBg = {
      ...oldRow,
      attributes: {
        ...oldRow.attributes,
        card_bg_url: "https://cdn3.futbin.com/content/fifa26/img/cards/tiny/0_silver.png?s=abc",
      },
    };
    const newAttrs = { ...withBg.attributes };
    const changes = upsert.diffFields(withBg, newCoins, newItemType, newAttrs);
    expect(changes).toEqual([]);
  });
});
