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

describe("MatchScoresDayControl (2026-04-26 single-page redesign)", () => {
  it("renders the Trigger + Hide footer pair (no part buttons)", () => {
    render(<MatchScoresDayControl sessionId="S" viewToken="T" />);
    // The 3-part split was retired — the operator now triggers the
    // full-day grid with one button.
    expect(screen.queryByTestId("v2-msd-part-1")).toBeNull();
    expect(screen.queryByTestId("v2-msd-part-2")).toBeNull();
    expect(screen.queryByTestId("v2-msd-part-3")).toBeNull();
    expect(screen.queryByTestId("v2-msd-part-all")).toBeNull();
    expect(
      screen.getByTestId("v2-retrigger-form-11-match-scores-day"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("v2-hide-form-11-match-scores-day"),
    ).toBeTruthy();
  });

  it("payload carries matchDayLabel (no partRange)", () => {
    const { container } = render(
      <MatchScoresDayControl sessionId="S" viewToken="T" />,
    );
    const form = container.querySelector(
      '[data-testid="v2-retrigger-form-11-match-scores-day"]',
    ) as HTMLFormElement;
    const payload = (
      form.querySelector('input[name="payload"]') as HTMLInputElement
    ).value;
    const parsed = JSON.parse(payload);
    expect(parsed.matchDayLabel.length).toBeGreaterThan(0);
    expect(parsed.partRange).toBeUndefined();
  });

  it("footer Trigger label is constant; Hide is enabled only when active", () => {
    const { rerender } = render(
      <MatchScoresDayControl sessionId="S" viewToken="T" active={false} />,
    );
    const triggerBtn1 = screen.getByTestId(
      "v2-retrigger-btn-11-match-scores-day",
    ) as HTMLButtonElement;
    const hideBtn1 = screen.getByTestId(
      "v2-hide-btn-11-match-scores-day",
    ) as HTMLButtonElement;
    expect(triggerBtn1.textContent?.trim()).toBe("Trigger");
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
    expect(triggerBtn2.textContent?.trim()).toBe("Trigger");
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
