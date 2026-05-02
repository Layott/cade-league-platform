import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import {
  ApplySquadToOtherMDs,
  type ApplySquadEligibleMatchDay,
} from "./ApplySquadToOtherMDs";

beforeEach(() => {
  cleanup();
});

const eligibleA: ApplySquadEligibleMatchDay = {
  matchDayId: "md-a",
  matchDate: "2026-05-09",
  venueName: "Lagos Arena",
  state: "open_no_submission",
};
const eligibleB: ApplySquadEligibleMatchDay = {
  matchDayId: "md-b",
  matchDate: "2026-05-10",
  venueName: "Lagos Arena",
  state: "pending_resubmit",
};

describe("ApplySquadToOtherMDs", () => {
  it("renders nothing when there are no eligible match days", () => {
    const { container } = render(
      <ApplySquadToOtherMDs
        sourceMatchDayId="src"
        sourceMatchDate="2026-05-02"
        eligible={[]}
        applyAction={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a collapsed disclosure with the count of eligible MDs", () => {
    render(
      <ApplySquadToOtherMDs
        sourceMatchDayId="src"
        sourceMatchDate="2026-05-02"
        eligible={[eligibleA, eligibleB]}
        applyAction={vi.fn()}
      />,
    );
    const root = screen.getByTestId("apply-squad-to-other-mds");
    expect(root).toBeTruthy();
    // Panel hidden until toggled.
    expect(screen.queryByTestId("apply-squad-panel")).toBeNull();
    // CTA toggle is rendered.
    const toggle = screen.getByTestId("apply-squad-toggle");
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(root.textContent).toContain("2 upcoming match days");
  });

  it("expands the panel + lists each eligible match day with a checkbox", () => {
    render(
      <ApplySquadToOtherMDs
        sourceMatchDayId="src"
        sourceMatchDate="2026-05-02"
        eligible={[eligibleA, eligibleB]}
        applyAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("apply-squad-toggle"));
    expect(screen.getByTestId("apply-squad-panel")).toBeTruthy();
    expect(screen.getByTestId(`apply-squad-cb-${eligibleA.matchDayId}`)).toBeTruthy();
    expect(screen.getByTestId(`apply-squad-cb-${eligibleB.matchDayId}`)).toBeTruthy();
    // All eligible MDs are pre-checked by default.
    const cbA = screen.getByTestId(
      `apply-squad-cb-${eligibleA.matchDayId}`,
    ) as HTMLInputElement;
    const cbB = screen.getByTestId(
      `apply-squad-cb-${eligibleB.matchDayId}`,
    ) as HTMLInputElement;
    expect(cbA.checked).toBe(true);
    expect(cbB.checked).toBe(true);
  });

  it("toggle-all flips every checkbox in unison", () => {
    render(
      <ApplySquadToOtherMDs
        sourceMatchDayId="src"
        sourceMatchDate="2026-05-02"
        eligible={[eligibleA, eligibleB]}
        applyAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("apply-squad-toggle"));

    const toggleAll = screen.getByTestId("apply-squad-toggle-all") as HTMLInputElement;
    // Initially all pre-checked → first click should clear.
    fireEvent.click(toggleAll);
    const cbA = screen.getByTestId(
      `apply-squad-cb-${eligibleA.matchDayId}`,
    ) as HTMLInputElement;
    expect(cbA.checked).toBe(false);
    // Second click re-checks.
    fireEvent.click(toggleAll);
    expect(
      (
        screen.getByTestId(
          `apply-squad-cb-${eligibleB.matchDayId}`,
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("calls applyAction with the selected target ids and renders the summary", async () => {
    const applyAction = vi.fn().mockResolvedValue({
      applied: ["md-a"],
      skipped: [{ matchDayId: "md-b", reason: "closed:past_deadline" }],
    });
    render(
      <ApplySquadToOtherMDs
        sourceMatchDayId="src"
        sourceMatchDate="2026-05-02"
        eligible={[eligibleA, eligibleB]}
        applyAction={applyAction}
      />,
    );
    fireEvent.click(screen.getByTestId("apply-squad-toggle"));
    fireEvent.click(screen.getByTestId("apply-squad-submit-btn"));

    await waitFor(() => {
      expect(applyAction).toHaveBeenCalledTimes(1);
    });
    const arg = applyAction.mock.calls[0][0];
    expect(arg.sourceMatchDayId).toBe("src");
    expect(arg.targetMatchDayIds.sort()).toEqual(["md-a", "md-b"]);

    // Summary renders applied + skipped counts.
    await waitFor(() => {
      expect(screen.getByTestId("apply-squad-result")).toBeTruthy();
    });
    expect(
      screen.getByTestId("apply-squad-applied-count").textContent,
    ).toBe("1");
    expect(
      screen.getByTestId("apply-squad-skipped-count").textContent,
    ).toBe("1");
    expect(screen.getByTestId("apply-squad-skipped-md-b").textContent).toContain(
      "closed:past_deadline",
    );
  });

  it("blocks submit when no targets are selected", () => {
    render(
      <ApplySquadToOtherMDs
        sourceMatchDayId="src"
        sourceMatchDate="2026-05-02"
        eligible={[eligibleA]}
        applyAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("apply-squad-toggle"));
    // Uncheck the only eligible MD.
    fireEvent.click(screen.getByTestId(`apply-squad-cb-${eligibleA.matchDayId}`));
    const btn = screen.getByTestId("apply-squad-submit-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
