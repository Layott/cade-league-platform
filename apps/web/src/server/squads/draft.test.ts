import { describe, it, expect, vi } from "vitest";
import { getDraft, saveDraft, clearDraft, type SaveDraftInput } from "./draft";
import type { CardSearchResult } from "@/server/fcdb/search";

const ACTOR = { userId: "u-1", roles: ["player"] } as const;
const PLAYER = "u-1";
const WEEK = "2026-04-16";

function mkCard(over: Partial<CardSearchResult> = {}): CardSearchResult {
  return {
    id: "fc-1",
    slug: "test_player",
    name: "Test Player",
    rating: 82,
    position: "ST",
    positionsAlt: [],
    club: null,
    league: null,
    nation: "Nigeria",
    nationIso: "NG",
    itemType: "gold",
    priceCoins: 50_000,
    cardImageUrl: null,
    cardBgUrl: null,
    variant: null,
    mainStats: null,
    weakFoot: null,
    skillMoves: null,
    metaRating: null,
    futbinNationId: null,
    futbinLeagueId: null,
    futbinClubId: null,
    ...over,
  };
}

type SbRow = {
  id: string;
  player_id: string;
  week_start_date: string;
  match_day_id: string | null;
  formation: string;
  slots_json: unknown;
  subs_json: unknown;
  screenshot_path: string | null;
  set_by: string;
  created_at: string;
  updated_at: string;
};

function mkRow(over: Partial<SbRow> = {}): SbRow {
  return {
    id: "draft-1",
    player_id: PLAYER,
    week_start_date: WEEK,
    match_day_id: null,
    formation: "433",
    slots_json: [],
    subs_json: [],
    screenshot_path: null,
    set_by: PLAYER,
    created_at: "2026-04-15T10:00:00Z",
    updated_at: "2026-04-15T10:00:00Z",
    ...over,
  };
}

/**
 * Builds a chainable Supabase mock for the squad_drafts table. The chain
 * supports the three call shapes used by the module:
 *   - getDraft:  .select(cols).eq().eq().is().maybeSingle()
 *                .select(cols).eq().eq().is().eq().maybeSingle() (matchDayId)
 *   - saveDraft (existence probe): .select("id").eq().eq().is().maybeSingle()
 *   - saveDraft (update):   .update(row).eq("id", X).select(cols).single()
 *   - saveDraft (insert):   .insert(row).select(cols).single()
 *   - clearDraft:           .update({deleted_at}).eq().eq().is()
 */
function mkSb(state: {
  /** Row returned by select-maybeSingle calls; null = no live draft. */
  existing?: SbRow | null;
  /** Row returned by .single() after an insert or update. */
  written?: SbRow;
}) {
  const existing = state.existing ?? null;
  const written =
    state.written ?? mkRow({ id: existing?.id ?? "draft-1" });

  const insertSingle = vi.fn().mockResolvedValue({ data: written, error: null });
  const insertChain = vi.fn(() => ({
    select: vi.fn(() => ({ single: insertSingle })),
  }));
  const updateSingle = vi.fn().mockResolvedValue({ data: written, error: null });
  // .update(row).eq("id", X).select(cols).single() — saveDraft UPDATE branch.
  const updateById = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({ single: updateSingle })),
    })),
  }));
  // .update({deleted_at}).eq().eq().is() — clearDraft branch (no .select()).
  const clearIs = vi.fn().mockResolvedValue({ error: null });
  const clearChain = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({ is: clearIs })),
    })),
  }));

  const update = vi.fn((payload: Record<string, unknown>) => {
    // Distinguish soft-delete vs upsert update by inspecting payload shape.
    if (payload && typeof payload.deleted_at === "string") {
      return clearChain();
    }
    return updateById();
  });

  // .select(...).eq().eq().is().maybeSingle()
  // .select(...).eq().eq().is().eq().maybeSingle()  (matchDayId branch in getDraft)
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: existing, error: null });
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          maybeSingle,
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
    })),
  }));

  const sb = {
    from: vi.fn((t: string) => {
      if (t !== "squad_drafts") {
        throw new Error(`unexpected table ${t}`);
      }
      return {
        select,
        insert: insertChain,
        update,
      };
    }),
    _spies: { insertSingle, updateSingle, clearIs, maybeSingle, update },
  };
  return sb;
}

describe("getDraft", () => {
  it("returns null when no live row exists", async () => {
    const sb = mkSb({ existing: null });
    const out = await getDraft(sb as never, PLAYER, WEEK);
    expect(out).toBeNull();
  });

  it("hydrates row → DraftRow with slots / subs / screenshot intact", async () => {
    const card = mkCard({ name: "Mbappé" });
    const row = mkRow({
      formation: "442",
      slots_json: [{ slotIndex: 0, card }],
      subs_json: [card, null, null, null, null, null, null],
      screenshot_path: "seasons/s/players/p/weeks/w/x.png",
      updated_at: "2026-04-30T12:34:56Z",
    });
    const sb = mkSb({ existing: row });
    const out = await getDraft(sb as never, PLAYER, WEEK);
    expect(out).not.toBeNull();
    expect(out!.formation).toBe("442");
    expect(out!.slots).toHaveLength(1);
    expect(out!.slots[0].card.name).toBe("Mbappé");
    expect(out!.subs[0]?.name).toBe("Mbappé");
    expect(out!.screenshotPath).toBe("seasons/s/players/p/weeks/w/x.png");
    expect(out!.updatedAt).toBe("2026-04-30T12:34:56Z");
  });

  it("filters by matchDayId when provided", async () => {
    const sb = mkSb({ existing: null });
    await getDraft(sb as never, PLAYER, WEEK, "md-1");
    expect(sb.from).toHaveBeenCalledWith("squad_drafts");
  });
});

describe("saveDraft", () => {
  function mkInput(over: Partial<SaveDraftInput> = {}): SaveDraftInput {
    return {
      playerId: PLAYER,
      weekStartDate: WEEK,
      matchDayId: null,
      formation: "433",
      slots: [{ slotIndex: 0, card: mkCard() }],
      subs: [null, null, null, null, null, null, null],
      screenshotPath: null,
      ...over,
    };
  }

  it("inserts a new row when none exists", async () => {
    const sb = mkSb({ existing: null });
    const out = await saveDraft(sb as never, ACTOR, mkInput());
    expect(out.formation).toBe("433");
    expect(sb._spies.insertSingle).toHaveBeenCalled();
    expect(sb._spies.updateSingle).not.toHaveBeenCalled();
  });

  it("updates the existing row when one is live", async () => {
    const sb = mkSb({
      existing: mkRow({ id: "draft-existing" }),
      written: mkRow({ id: "draft-existing", formation: "442" }),
    });
    const out = await saveDraft(
      sb as never,
      ACTOR,
      mkInput({ formation: "442" }),
    );
    expect(out.formation).toBe("442");
    expect(sb._spies.updateSingle).toHaveBeenCalled();
    expect(sb._spies.insertSingle).not.toHaveBeenCalled();
  });

  it("throws when actor.userId is null", async () => {
    const sb = mkSb({ existing: null });
    await expect(
      saveDraft(sb as never, { userId: null, roles: [] }, mkInput()),
    ).rejects.toThrow(/no actor.userId/i);
  });

  it("is idempotent across repeated saves (existing row → update path)", async () => {
    const sb = mkSb({
      existing: mkRow(),
      written: mkRow(),
    });
    await saveDraft(sb as never, ACTOR, mkInput());
    await saveDraft(sb as never, ACTOR, mkInput({ formation: "352" }));
    expect(sb._spies.updateSingle).toHaveBeenCalledTimes(2);
  });
});

describe("clearDraft", () => {
  it("soft-deletes the live draft", async () => {
    const sb = mkSb({ existing: mkRow() });
    await clearDraft(sb as never, PLAYER, WEEK);
    expect(sb._spies.clearIs).toHaveBeenCalled();
    // Verify the update payload carries a deleted_at ISO string.
    const updateCalls = sb._spies.update.mock.calls;
    const last = updateCalls[updateCalls.length - 1]?.[0] as
      | { deleted_at: string }
      | undefined;
    expect(last?.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("is a no-op when no live draft exists (still resolves)", async () => {
    const sb = mkSb({ existing: null });
    await expect(
      clearDraft(sb as never, PLAYER, WEEK),
    ).resolves.toBeUndefined();
  });
});
