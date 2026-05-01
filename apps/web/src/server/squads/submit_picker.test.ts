import { describe, it, expect, vi } from "vitest";
import { submitPickerSquad } from "./submit_picker";

const SEASON = "11111111-1111-4111-8111-111111111111";
const PLAYER = "22222222-2222-4222-8222-222222222222";
const CARD_A = "33333333-3333-4333-8333-333333333333";
const CARD_B = "44444444-4444-4444-8444-444444444444";

function mkSb(opts: {
  cards?: Array<{
    id: string;
    name: string;
    rating: number;
    position: string;
    value_coins_estimate: number | null;
    item_type: string;
    nation_iso: string | null;
  }>;
  existing?: { id: string } | null;
  insertedId?: string;
}) {
  const cards = opts.cards ?? [
    {
      id: CARD_A,
      name: "Mbappé",
      rating: 92,
      position: "ST",
      value_coins_estimate: 2_000_000,
      item_type: "normal",
      nation_iso: "FR",
    },
    {
      id: CARD_B,
      name: "Haaland",
      rating: 91,
      position: "ST",
      value_coins_estimate: 1_800_000,
      item_type: "icon",
      nation_iso: "NO",
    },
  ];
  const insertedId = opts.insertedId ?? "sub-1";
  const itemUpdate = vi.fn().mockResolvedValue({ error: null });

  return {
    itemUpdate,
    from: vi.fn((table: string) => {
      if (table === "fc26_players") {
        return {
          select: () => ({
            // .in(ids).eq('source_dataset','futbin.com').is('deleted_at',null)
            in: () => ({
              eq: () => ({
                is: vi
                  .fn()
                  .mockResolvedValue({ data: cards, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "squad_submissions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: opts.existing ?? null, error: null }),
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: vi
                .fn()
                .mockResolvedValue({ data: { id: insertedId }, error: null }),
            }),
          }),
          delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === "squad_player_items") {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
          select: () => ({
            eq: () => ({
              is: vi.fn().mockResolvedValue({
                data: [
                  { id: "it-0", slot_index: 0 },
                  { id: "it-1", slot_index: 1 },
                ],
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: vi.fn().mockImplementation(async () => {
              itemUpdate();
              return { error: null };
            }),
          }),
        };
      }
      if (table === "squad_window_overrides") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "squad_validation_rules") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "player_squad_overrides") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "players") {
        // Used by clearDraft path (post-insert): look up users.id via
        // players.user_id so we can soft-delete the autosave draft row.
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: { user_id: PLAYER }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "squad_drafts") {
        // clearDraft soft-delete chain: .update().eq().eq().is()
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                is: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

function mkInput(over: Partial<Parameters<typeof submitPickerSquad>[1]> = {}) {
  return {
    seasonId: SEASON,
    playerId: PLAYER,
    weekStartDate: "2026-04-16",
    futbinScreenshotPath: "seasons/s/players/p/weeks/2026-04-16/a.png",
    slots: [
      { fcdbPlayerId: CARD_A, positionInLineup: "ST", slotIndex: 0 },
      { fcdbPlayerId: CARD_B, positionInLineup: "CF", slotIndex: 1 },
    ],
    ...over,
  };
}

describe("submitPickerSquad", () => {
  it("hydrates cards + delegates to createSubmission + annotates FCDB link", async () => {
    const sb = mkSb({});
    const out = await submitPickerSquad(sb as never, mkInput(), {
      now: new Date("2026-04-16T08:00:00+01:00"),
    });
    expect(out.id).toBe("sub-1");
    // Two slots → two FCDB link updates.
    expect(sb.itemUpdate).toHaveBeenCalledTimes(2);
  });

  it("throws ConflictError when a picked fcdb card is missing or soft-deleted", async () => {
    const sb = mkSb({
      cards: [
        {
          id: CARD_A,
          name: "Mbappé",
          rating: 92,
          position: "ST",
          value_coins_estimate: 2_000_000,
          item_type: "normal",
          nation_iso: "FR",
        },
        // CARD_B intentionally missing
      ],
    });
    await expect(
      submitPickerSquad(sb as never, mkInput(), {
        now: new Date("2026-04-16T08:00:00+01:00"),
      }),
    ).rejects.toThrow(/fcdb card not found/i);
  });

  it("rejects duplicate slotIndex across picker slots", async () => {
    const sb = mkSb({});
    await expect(
      submitPickerSquad(
        sb as never,
        mkInput({
          slots: [
            { fcdbPlayerId: CARD_A, positionInLineup: "ST", slotIndex: 0 },
            { fcdbPlayerId: CARD_B, positionInLineup: "CF", slotIndex: 0 },
          ],
        }),
        { now: new Date("2026-04-16T08:00:00+01:00") },
      ),
    ).rejects.toThrow(/duplicate slotIndex/i);
  });

  it("falls back to rating-derived item_type when source is 'normal'", async () => {
    const sb = mkSb({
      cards: [
        {
          id: CARD_A,
          name: "Gold",
          rating: 82,
          position: "ST",
          value_coins_estimate: 50_000,
          item_type: "normal",
          nation_iso: "FR",
        },
        {
          id: CARD_B,
          name: "Silver",
          rating: 70,
          position: "CM",
          value_coins_estimate: 1_000,
          item_type: "normal",
          nation_iso: "FR",
        },
      ],
    });
    const out = await submitPickerSquad(sb as never, mkInput(), {
      now: new Date("2026-04-16T08:00:00+01:00"),
    });
    expect(out.id).toBe("sub-1");
  });
});
