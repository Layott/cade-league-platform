import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  triggerOverlayEnterAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
  toggleOverlayAction: vi.fn(async () => undefined),
  retriggerOverlayAction: vi.fn(async () => undefined),
}));

import { SecondaryScoreBugControl } from "./SecondaryScoreBugControl";

beforeEach(() => {
  cleanup();
});

describe("SecondaryScoreBugControl", () => {
  it("renders both player dropdowns + score inputs", () => {
    render(<SecondaryScoreBugControl sessionId="S" viewToken="T" />);
    expect(screen.getByTestId("v2-scorebug-player-a")).toBeTruthy();
    expect(screen.getByTestId("v2-scorebug-player-b")).toBeTruthy();
    expect(screen.getByTestId("v2-scorebug-score-a")).toBeTruthy();
    expect(screen.getByTestId("v2-scorebug-score-b")).toBeTruthy();
  });

  it("payload carries `players` array of length 2 with displayName + score", () => {
    const { container } = render(
      <SecondaryScoreBugControl sessionId="S" viewToken="T" />,
    );
    const payload = (
      container.querySelector(
        'input[name="payload"]',
      ) as HTMLInputElement
    ).value;
    const parsed = JSON.parse(payload);
    expect(parsed.players.length).toBe(2);
    expect(parsed.players[0].displayName).toBe("BAJI JNR");
    expect(parsed.players[0].score).toBe(0);
  });

  it("editing score A updates the payload", () => {
    const { container } = render(
      <SecondaryScoreBugControl sessionId="S" viewToken="T" />,
    );
    const scoreA = screen.getByTestId("v2-scorebug-score-a") as HTMLInputElement;
    fireEvent.change(scoreA, { target: { value: "3" } });
    const payload = (
      container.querySelector(
        'input[name="payload"]',
      ) as HTMLInputElement
    ).value;
    const parsed = JSON.parse(payload);
    expect(parsed.players[0].score).toBe(3);
  });

  it("re-trigger refresh — payload reflects latest score + slug across changes", () => {
    const { container } = render(
      <SecondaryScoreBugControl sessionId="S" viewToken="T" />,
    );
    const scoreA = screen.getByTestId(
      "v2-scorebug-score-a",
    ) as HTMLInputElement;
    const scoreB = screen.getByTestId(
      "v2-scorebug-score-b",
    ) as HTMLInputElement;
    const playerA = screen.getByTestId(
      "v2-scorebug-player-a",
    ) as HTMLSelectElement;
    const getPayload = () =>
      JSON.parse(
        (
          container.querySelector(
            'input[name="payload"]',
          ) as HTMLInputElement
        ).value,
      );

    // Initial → toggle ON → score 0-0
    expect(getPayload().players[0].score).toBe(0);

    // First change
    fireEvent.change(scoreA, { target: { value: "1" } });
    fireEvent.change(scoreB, { target: { value: "0" } });
    expect(getPayload().players[0].score).toBe(1);

    // Second change — re-trigger must reflect new values, not stale 1-0
    fireEvent.change(scoreA, { target: { value: "2" } });
    fireEvent.change(scoreB, { target: { value: "3" } });
    fireEvent.change(playerA, { target: { value: "faruk" } });
    const after = getPayload();
    expect(after.players[0].displayName).toBe("FARUK");
    expect(after.players[0].score).toBe(2);
    expect(after.players[1].score).toBe(3);
  });

  it("renders BOTH Trigger + Hide forms (re-trigger pattern)", () => {
    const { container } = render(
      <SecondaryScoreBugControl sessionId="S" viewToken="T" />,
    );
    expect(
      container.querySelector(
        '[data-testid="v2-retrigger-form-09-secondary-score-bug"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector(
        '[data-testid="v2-hide-form-09-secondary-score-bug"]',
      ),
    ).toBeTruthy();
  });

  it("Trigger button always says 'Trigger' regardless of active state", () => {
    const { rerender } = render(
      <SecondaryScoreBugControl
        sessionId="S"
        viewToken="T"
        active={false}
      />,
    );
    let btn = screen.getByTestId(
      "v2-retrigger-btn-09-secondary-score-bug",
    ) as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe("Trigger");

    rerender(
      <SecondaryScoreBugControl
        sessionId="S"
        viewToken="T"
        active={true}
      />,
    );
    btn = screen.getByTestId(
      "v2-retrigger-btn-09-secondary-score-bug",
    ) as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe("Trigger");
  });

  it("active=true shows the Live badge", () => {
    render(
      <SecondaryScoreBugControl
        sessionId="S"
        viewToken="T"
        active={true}
      />,
    );
    expect(
      screen.getByTestId("v2-live-badge-09-secondary-score-bug"),
    ).toBeTruthy();
  });
});
