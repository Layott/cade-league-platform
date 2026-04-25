import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  triggerOverlayEnterAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
  toggleOverlayAction: vi.fn(async () => undefined),
  retriggerOverlayAction: vi.fn(async () => undefined),
}));

import { MatchScoresDayControl } from "./MatchScoresDayControl";

beforeEach(() => {
  cleanup();
});

describe("MatchScoresDayControl", () => {
  it("renders 4 part buttons (1, 2, 3, all) + a footer Trigger + Hide pair", () => {
    render(<MatchScoresDayControl sessionId="S" viewToken="T" />);
    expect(screen.getByTestId("v2-msd-part-1")).toBeTruthy();
    expect(screen.getByTestId("v2-msd-part-2")).toBeTruthy();
    expect(screen.getByTestId("v2-msd-part-3")).toBeTruthy();
    expect(screen.getByTestId("v2-msd-part-all")).toBeTruthy();
    expect(
      screen.getByTestId("v2-retrigger-form-11-match-scores-day"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("v2-hide-form-11-match-scores-day"),
    ).toBeTruthy();
  });

  it("each part button form includes the matching partRange in the payload", () => {
    const { container } = render(
      <MatchScoresDayControl sessionId="S" viewToken="T" />,
    );
    for (const id of [1, 2, 3, "all"] as const) {
      const form = container.querySelector(
        `[data-testid="v2-msd-part-form-${id}"]`,
      ) as HTMLFormElement;
      expect(form).toBeTruthy();
      const payload = (
        form.querySelector('input[name="payload"]') as HTMLInputElement
      ).value;
      const parsed = JSON.parse(payload);
      expect(parsed.partRange).toBe(id);
      // matchDayLabel must satisfy the legacy Zod min(1) requirement.
      expect(parsed.matchDayLabel.length).toBeGreaterThan(0);
    }
  });

  it("footer Trigger button label stays constant; Hide is enabled only when active", () => {
    const { rerender } = render(
      <MatchScoresDayControl sessionId="S" viewToken="T" active={false} />,
    );
    const triggerBtn1 = screen.getByTestId(
      "v2-retrigger-btn-11-match-scores-day",
    ) as HTMLButtonElement;
    const hideBtn1 = screen.getByTestId(
      "v2-hide-btn-11-match-scores-day",
    ) as HTMLButtonElement;
    expect(triggerBtn1.textContent?.trim()).toBe("Trigger (Show all)");
    expect(hideBtn1.disabled).toBe(true);

    rerender(
      <MatchScoresDayControl sessionId="S" viewToken="T" active={true} />,
    );
    const triggerBtn2 = screen.getByTestId(
      "v2-retrigger-btn-11-match-scores-day",
    ) as HTMLButtonElement;
    const hideBtn2 = screen.getByTestId(
      "v2-hide-btn-11-match-scores-day",
    ) as HTMLButtonElement;
    expect(triggerBtn2.textContent?.trim()).toBe("Trigger (Show all)");
    expect(hideBtn2.disabled).toBe(false);
  });

  it("active=true shows the Live badge", () => {
    render(
      <MatchScoresDayControl sessionId="S" viewToken="T" active={true} />,
    );
    expect(
      screen.getByTestId("v2-live-badge-11-match-scores-day"),
    ).toBeTruthy();
  });
});
