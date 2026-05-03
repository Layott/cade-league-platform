import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SquadPickerBuilder } from "./SquadPickerBuilder";
import type { CardSearchResult } from "@/server/fcdb/search";

function mkCard(over: Partial<CardSearchResult> = {}): CardSearchResult {
  // Unique slug by default so the picker's one-per-player dedup doesn't
  // reject repeat picks in tests that simulate filling 11 slots.
  const uid = Math.random().toString(36).slice(2, 8);
  return {
    id: "id-" + uid,
    slug: "test_player_" + uid,
    name: "Test Player",
    rating: 82,
    position: "ST",
    positionsAlt: [],
    club: "Test FC",
    league: "Test League",
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

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("SquadPickerBuilder", () => {
  it("renders formation switcher + pitch with 11 empty slots", () => {
    render(
      <SquadPickerBuilder
        weekStartDate="2026-04-16"
        rule={{
          maxBudgetCoins: 10_000_000,
          minNigerianItems: 1,
          bannedItemTypes: [],
        }}
        submitAction={vi.fn()}
      />,
    );

    expect(screen.getByTestId("formation-switcher")).toBeTruthy();
    expect(screen.getByTestId("pitch-layout")).toBeTruthy();
    // 11 slot buttons on the pitch.
    for (let i = 0; i < 11; i++) {
      expect(screen.getByTestId(`pitch-slot-${i}`)).toBeTruthy();
    }
  });

  it("keeps submit disabled until 11 slots filled", () => {
    render(
      <SquadPickerBuilder
        weekStartDate="2026-04-16"
        rule={null}
        submitAction={vi.fn()}
      />,
    );
    const btn = screen.getByTestId("picker-submit-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("swaps formation without discarding already-filled slot 0 (GK)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [mkCard({ position: "GK" })] }),
    });
    render(
      <SquadPickerBuilder
        weekStartDate="2026-04-16"
        rule={null}
        submitAction={vi.fn()}
      />,
    );

    // Open slot 0 → search dialog.
    fireEvent.click(screen.getByTestId("pitch-slot-0"));
    expect(screen.getByTestId("card-search-dialog")).toBeTruthy();

    // Type a search → fetch fires.
    fireEvent.change(screen.getByTestId("card-search-input"), {
      target: { value: "Neuer" },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const result = await screen.findByTestId("card-search-result-0");
    expect(result).toBeTruthy();

    // Pick.
    fireEvent.click(result.querySelector("button[type='button']")!);

    // Switch formation — slot 0 (GK) remains across 4-3-3 → 4-4-2.
    fireEvent.click(screen.getByTestId("formation-442"));
    const slot0 = screen.getByTestId("pitch-slot-0");
    // After a pick slot 0 should carry data-card-id set.
    expect(slot0.getAttribute("data-card-id")).toBeTruthy();
  });

  it("preserves GK + CB picks when swapping from 4-3-3 to 5-3-2", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).startsWith("/api/fcdb/search")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ results: [mkCard()] }),
        });
      }
      return Promise.resolve({ ok: true });
    });

    render(
      <SquadPickerBuilder
        weekStartDate="2026-04-16"
        rule={null}
        submitAction={vi.fn()}
      />,
    );

    // Fill GK (slot 0) + both CBs (slots 2, 3 in 4-3-3).
    for (const idx of [0, 2, 3]) {
      fireEvent.click(screen.getByTestId(`pitch-slot-${idx}`));
      fireEvent.change(screen.getByTestId("card-search-input"), {
        target: { value: `Name${idx}00` },
      });
      const row = await screen.findByTestId("card-search-result-0");
      fireEvent.click(row.querySelector("button[type='button']")!);
    }

    // Swap to 5-3-2 via the hidden testid-shim button.
    fireEvent.click(screen.getByTestId("formation-532"));

    // In 5-3-2: GK stays at slot 0, and the three CBs map into 2/3/4.
    const gkSlot = screen.getByTestId("pitch-slot-0");
    expect(gkSlot.getAttribute("data-card-id")).toBeTruthy();

    // At least two CB slots in 5-3-2 should carry cards (remap up to two
    // 4-3-3 CBs into the three 5-3-2 CB slots).
    const cbFilled =
      [2, 3, 4].filter(
        (i) =>
          screen
            .getByTestId(`pitch-slot-${i}`)
            .getAttribute("data-card-id") !== null,
      ).length;
    expect(cbFilled).toBeGreaterThanOrEqual(2);
  });

  it("hydrates state from initialSquad (edit mode) overriding initialDraft", () => {
    const draftCard = mkCard({ name: "Draft Pick", id: "draft-id" });
    const editCard = mkCard({ name: "Live Submission", id: "live-id" });
    render(
      <SquadPickerBuilder
        weekStartDate="2026-04-16"
        rule={null}
        submitAction={vi.fn()}
        initialDraft={{
          formation: "433",
          slots: [{ slotIndex: 0, card: draftCard }],
          subs: Array(7).fill(null),
          screenshotPath: null,
          updatedAt: "2026-04-30T10:00:00Z",
        }}
        initialSquad={{
          formation: "442",
          slots: [{ slotIndex: 0, card: editCard }],
          subs: [editCard, null, null, null, null, null, null],
        }}
      />,
    );
    // Slot 0 picks the live submission (live-id), NOT the draft (draft-id).
    expect(screen.getByTestId("pitch-slot-0").getAttribute("data-card-id")).toBe(
      "live-id",
    );
    // Sub slot 0 hydrated from initialSquad.
    expect(screen.getByTestId("sub-slot-0").getAttribute("data-card-id")).toBe(
      "live-id",
    );
  });

  it("clears all roster state when clear-roster button is confirmed", async () => {
    const card = mkCard({ name: "Will be cleared", id: "to-clear" });
    const clearDraftAction = vi.fn().mockResolvedValue({ ok: true });
    // Stub window.confirm → true so the click proceeds without prompting.
    const originalConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);

    render(
      <SquadPickerBuilder
        weekStartDate="2026-04-16"
        rule={null}
        submitAction={vi.fn()}
        initialSquad={{
          formation: "442",
          slots: [
            { slotIndex: 0, card },
            { slotIndex: 1, card: mkCard({ id: "card-1" }) },
          ],
          subs: [card, null, null, null, null, null, null],
        }}
        clearDraftAction={clearDraftAction}
      />,
    );

    // Pre-state: slot 0 carries the hydrated card.
    expect(
      screen.getByTestId("pitch-slot-0").getAttribute("data-card-id"),
    ).toBe("to-clear");

    // Click the clear-roster button.
    fireEvent.click(screen.getByTestId("picker-clear-roster-btn"));

    // After clearing, no slots should carry data-card-id.
    await waitFor(() => {
      const cleared =
        screen.getByTestId("pitch-slot-0").getAttribute("data-card-id") ===
          null &&
        screen.getByTestId("pitch-slot-1").getAttribute("data-card-id") ===
          null;
      expect(cleared).toBe(true);
    });
    // Sub slot 0 should be empty too.
    expect(
      screen.getByTestId("sub-slot-0").getAttribute("data-card-id"),
    ).toBeNull();

    // clearDraftAction was invoked with the right input.
    expect(clearDraftAction).toHaveBeenCalledTimes(1);
    expect(clearDraftAction.mock.calls[0][0]).toEqual({
      weekStartDate: "2026-04-16",
      matchDayId: null,
    });

    window.confirm = originalConfirm;
  });

  it("does NOT clear roster when the clear-roster confirmation is dismissed", () => {
    const card = mkCard({ name: "Stays", id: "stays-id" });
    const clearDraftAction = vi.fn();
    const originalConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(false);

    render(
      <SquadPickerBuilder
        weekStartDate="2026-04-16"
        rule={null}
        submitAction={vi.fn()}
        initialSquad={{
          formation: "433",
          slots: [{ slotIndex: 0, card }],
          subs: Array(7).fill(null),
        }}
        clearDraftAction={clearDraftAction}
      />,
    );

    fireEvent.click(screen.getByTestId("picker-clear-roster-btn"));

    // Slot still carries the original card — confirm dismissed.
    expect(
      screen.getByTestId("pitch-slot-0").getAttribute("data-card-id"),
    ).toBe("stays-id");
    expect(clearDraftAction).not.toHaveBeenCalled();

    window.confirm = originalConfirm;
  });

  it("hydrates state from initialDraft on mount (formation + slot 0 visible)", () => {
    const card = mkCard({ name: "Hydrated" });
    render(
      <SquadPickerBuilder
        weekStartDate="2026-04-16"
        rule={null}
        submitAction={vi.fn()}
        initialDraft={{
          formation: "442",
          slots: [{ slotIndex: 0, card }],
          subs: [card, null, null, null, null, null, null],
          screenshotPath: "seasons/s/players/p/weeks/w/x.png",
          updatedAt: "2026-04-30T10:00:00Z",
        }}
      />,
    );
    // Slot 0 carries data-card-id from the hydrated card.
    expect(
      screen.getByTestId("pitch-slot-0").getAttribute("data-card-id"),
    ).toBeTruthy();
    // Sub slot 0 also hydrated.
    expect(
      screen.getByTestId("sub-slot-0").getAttribute("data-card-id"),
    ).toBeTruthy();
  });

  it("fires saveDraftAction (debounced) after a pick", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).startsWith("/api/fcdb/search")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ results: [mkCard()] }),
        });
      }
      return Promise.resolve({ ok: true });
    });
    const saveDraftAction = vi
      .fn()
      .mockResolvedValue({ ok: true, updatedAt: "2026-04-30T10:00:00Z" });

    render(
      <SquadPickerBuilder
        weekStartDate="2026-04-16"
        rule={null}
        submitAction={vi.fn()}
        saveDraftAction={saveDraftAction}
      />,
    );

    fireEvent.click(screen.getByTestId("pitch-slot-0"));
    fireEvent.change(screen.getByTestId("card-search-input"), {
      target: { value: "Mbappe" },
    });
    const row = await screen.findByTestId("card-search-result-0");
    fireEvent.click(row.querySelector("button[type='button']")!);

    // 800ms debounce → wait until autosave fires.
    await waitFor(
      () => {
        expect(saveDraftAction).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    const payload = saveDraftAction.mock.calls[0][0];
    expect(payload.weekStartDate).toBe("2026-04-16");
    expect(Array.isArray(payload.slots)).toBe(true);
    expect(payload.slots.length).toBe(1);
    expect(payload.slots[0].slotIndex).toBe(0);
  });

  it("enables submit button once all 11 slots are filled", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).startsWith("/api/fcdb/search")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ results: [mkCard()] }),
        });
      }
      return Promise.resolve({ ok: true });
    });

    render(
      <SquadPickerBuilder
        weekStartDate="2026-04-16"
        rule={null}
        submitAction={vi.fn()}
      />,
    );

    // Fill all 11 starter slots.
    for (let i = 0; i < 11; i++) {
      fireEvent.click(screen.getByTestId(`pitch-slot-${i}`));
      fireEvent.change(screen.getByTestId("card-search-input"), {
        target: { value: `Name${i}00` },
      });
      const row = await screen.findByTestId("card-search-result-0");
      fireEvent.click(row.querySelector("button[type='button']")!);
    }

    const btn = screen.getByTestId("picker-submit-btn") as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
  });
});
