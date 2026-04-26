import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { TiebreakerDragRank, DEFAULT_ORDER } from "./TiebreakerDragRank";

afterEach(() => cleanup());

describe("TiebreakerDragRank", () => {
  it("renders one row per key in initialOrder", () => {
    render(
      <TiebreakerDragRank
        initialOrder={DEFAULT_ORDER}
        saveAction={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );
    for (const key of DEFAULT_ORDER) {
      expect(screen.getByTestId(`tiebreaker-row-${key}`)).toBeTruthy();
    }
  });

  it("disables the up arrow on the first row", () => {
    render(
      <TiebreakerDragRank
        initialOrder={DEFAULT_ORDER}
        saveAction={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );
    const firstRow = screen.getByTestId("tiebreaker-row-totalPts");
    const upBtn = firstRow.querySelector(
      "button[aria-label^='Move']",
    ) as HTMLButtonElement | null;
    expect(upBtn?.disabled).toBe(true);
  });

  it("moves a key down via the down arrow", () => {
    render(
      <TiebreakerDragRank
        initialOrder={["totalPts", "gd", "gf"]}
        saveAction={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );
    const totalPtsRow = screen.getByTestId("tiebreaker-row-totalPts");
    const downBtn = totalPtsRow.querySelector(
      "button[aria-label='Move Total Points down']",
    ) as HTMLButtonElement;
    fireEvent.click(downBtn);
    // After the move the ordered list should be gd, totalPts, gf.
    // (Bugfix 2026-04-26: `name` no longer appears in the user-facing
    // ladder — engine still anchors with name automatically.)
    const list = screen.getByTestId("tiebreaker-list");
    const positions = Array.from(list.querySelectorAll("li")).map(
      (li) => li.getAttribute("data-testid"),
    );
    expect(positions).toEqual([
      "tiebreaker-row-gd",
      "tiebreaker-row-totalPts",
      "tiebreaker-row-gf",
    ]);
  });

  it("Save button is disabled until the order changes", () => {
    render(
      <TiebreakerDragRank
        initialOrder={DEFAULT_ORDER}
        saveAction={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );
    const saveBtn = screen.getByTestId("tiebreaker-save") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("Reset restores the canonical default order", () => {
    render(
      <TiebreakerDragRank
        initialOrder={["wins", "gf", "name"]}
        saveAction={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );
    const reset = screen.getByText(/Reset to default/i);
    fireEvent.click(reset);
    for (const key of DEFAULT_ORDER) {
      expect(screen.getByTestId(`tiebreaker-row-${key}`)).toBeTruthy();
    }
  });

  it("calls saveAction with the current order on click", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(
      <TiebreakerDragRank
        initialOrder={["totalPts", "gd", "gf"]}
        saveAction={action}
      />,
    );
    // Reorder so save becomes enabled.
    const totalPtsRow = screen.getByTestId("tiebreaker-row-totalPts");
    const downBtn = totalPtsRow.querySelector(
      "button[aria-label='Move Total Points down']",
    ) as HTMLButtonElement;
    fireEvent.click(downBtn);
    fireEvent.click(screen.getByTestId("tiebreaker-save"));
    await waitFor(() =>
      expect(action).toHaveBeenCalledWith(["gd", "totalPts", "gf"]),
    );
  });

  it("surfaces save errors inline", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: "boom" });
    render(
      <TiebreakerDragRank
        initialOrder={["totalPts", "gd", "name"]}
        saveAction={action}
      />,
    );
    const downBtn = screen
      .getByTestId("tiebreaker-row-totalPts")
      .querySelector(
        "button[aria-label='Move Total Points down']",
      ) as HTMLButtonElement;
    fireEvent.click(downBtn);
    fireEvent.click(screen.getByTestId("tiebreaker-save"));
    await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());
  });

  it("can add an unused key from the chip strip", () => {
    render(
      <TiebreakerDragRank
        initialOrder={["totalPts", "name"]}
        saveAction={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );
    const addBtn = screen.getByTestId("tiebreaker-add-wins");
    fireEvent.click(addBtn);
    expect(screen.getByTestId("tiebreaker-row-wins")).toBeTruthy();
  });

  it("removes a non-name key when the X button is clicked", () => {
    render(
      <TiebreakerDragRank
        initialOrder={["totalPts", "gd", "name"]}
        saveAction={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );
    const gdRow = screen.getByTestId("tiebreaker-row-gd");
    const removeBtn = gdRow.querySelector(
      "button[aria-label='Remove Goal Difference']",
    ) as HTMLButtonElement;
    fireEvent.click(removeBtn);
    expect(screen.queryByTestId("tiebreaker-row-gd")).toBeNull();
  });
});
