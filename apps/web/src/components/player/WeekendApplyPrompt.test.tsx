import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { WeekendApplyPrompt } from "./WeekendApplyPrompt";

beforeEach(() => {
  cleanup();
});

const baseProps = {
  sourceMatchDayId: "src-md",
  sourceMatchDate: "2026-05-02",
  sourceDayLabel: "Saturday May 2",
  siblingMatchDayId: "sib-md",
  siblingMatchDate: "2026-05-03",
  siblingDayLabel: "Sunday May 3",
};

describe("WeekendApplyPrompt", () => {
  it("renders the banner with source + sibling labels and both CTAs", () => {
    render(
      <WeekendApplyPrompt
        {...baseProps}
        applyAction={vi.fn()}
      />,
    );
    const root = screen.getByTestId("weekend-apply-prompt");
    expect(root).toBeTruthy();
    expect(root.textContent).toContain("Saturday May 2");
    expect(root.textContent).toContain("Sunday May 3");
    expect(screen.getByTestId("weekend-apply-prompt-apply-btn")).toBeTruthy();
    expect(screen.getByTestId("weekend-apply-prompt-dismiss-btn")).toBeTruthy();
  });

  it("calls applyAction with the sibling MD when the player clicks Apply", async () => {
    const applyAction = vi
      .fn()
      .mockResolvedValue({ applied: ["sib-md"], skipped: [] });
    render(
      <WeekendApplyPrompt
        {...baseProps}
        applyAction={applyAction}
      />,
    );
    fireEvent.click(screen.getByTestId("weekend-apply-prompt-apply-btn"));
    await waitFor(() => {
      expect(applyAction).toHaveBeenCalledTimes(1);
    });
    const arg = applyAction.mock.calls[0][0];
    expect(arg.sourceMatchDayId).toBe("src-md");
    expect(arg.targetMatchDayIds).toEqual(["sib-md"]);

    await waitFor(() => {
      expect(screen.getByTestId("weekend-apply-prompt-applied")).toBeTruthy();
    });
  });

  it("renders the skipped reason when the apply skips the sibling", async () => {
    const applyAction = vi.fn().mockResolvedValue({
      applied: [],
      skipped: [{ matchDayId: "sib-md", reason: "closed:past_deadline" }],
    });
    render(
      <WeekendApplyPrompt
        {...baseProps}
        applyAction={applyAction}
      />,
    );
    fireEvent.click(screen.getByTestId("weekend-apply-prompt-apply-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("weekend-apply-prompt-skipped")).toBeTruthy();
    });
    expect(
      screen.getByTestId("weekend-apply-prompt-skipped").textContent,
    ).toContain("closed:past_deadline");
  });

  it("dismisses (renders null) when the player clicks the dismiss CTA", () => {
    const { container } = render(
      <WeekendApplyPrompt
        {...baseProps}
        applyAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("weekend-apply-prompt-dismiss-btn"));
    expect(container.firstChild).toBeNull();
  });

  it("surfaces an error banner when the action throws", async () => {
    const applyAction = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <WeekendApplyPrompt
        {...baseProps}
        applyAction={applyAction}
      />,
    );
    fireEvent.click(screen.getByTestId("weekend-apply-prompt-apply-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("weekend-apply-prompt-error")).toBeTruthy();
    });
    expect(screen.getByTestId("weekend-apply-prompt-error").textContent).toContain(
      "boom",
    );
  });
});
