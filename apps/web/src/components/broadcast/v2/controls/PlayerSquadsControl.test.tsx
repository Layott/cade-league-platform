import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  triggerOverlayEnterAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
  toggleOverlayAction: vi.fn(async () => undefined),
  retriggerOverlayAction: vi.fn(async () => undefined),
}));

import { PlayerSquadsControl, type PlayerOption } from "./PlayerSquadsControl";

const PLAYERS: PlayerOption[] = [
  { playerId: "11111111-1111-1111-1111-111111111111", displayName: "BAJI JNR", gamerTag: "baji_jnr" },
  { playerId: "22222222-2222-2222-2222-222222222222", displayName: "KING NONEX", gamerTag: "kingnonex" },
  { playerId: "33333333-3333-3333-3333-333333333333", displayName: "FARUK", gamerTag: "faruk" },
];

beforeEach(() => {
  cleanup();
});

describe("PlayerSquadsControl", () => {
  it("renders the player picker dropdown", () => {
    render(
      <PlayerSquadsControl sessionId="S" viewToken="T" players={PLAYERS} />,
    );
    expect(screen.getByTestId("player-squads-control-picker")).toBeTruthy();
  });

  it("renders BOTH Trigger + Hide forms (re-trigger pattern, same as h2h-2)", () => {
    const { container } = render(
      <PlayerSquadsControl sessionId="S" viewToken="T" players={PLAYERS} />,
    );
    expect(
      container.querySelector(
        '[data-testid="v2-retrigger-form-19-player-squads"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="v2-hide-form-19-player-squads"]'),
    ).toBeTruthy();
  });

  it("Hide button label says 'Trigger OFF' (per user-mandated label)", () => {
    render(
      <PlayerSquadsControl
        sessionId="S"
        viewToken="T"
        active={true}
        players={PLAYERS}
      />,
    );
    const btn = screen.getByTestId(
      "v2-hide-btn-19-player-squads",
    ) as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe("Trigger OFF");
  });

  it("Hide button is disabled when inactive, enabled when active", () => {
    const { rerender } = render(
      <PlayerSquadsControl
        sessionId="S"
        viewToken="T"
        active={false}
        players={PLAYERS}
      />,
    );
    let hideBtn = screen.getByTestId(
      "v2-hide-btn-19-player-squads",
    ) as HTMLButtonElement;
    expect(hideBtn.disabled).toBe(true);

    rerender(
      <PlayerSquadsControl
        sessionId="S"
        viewToken="T"
        active={true}
        players={PLAYERS}
      />,
    );
    hideBtn = screen.getByTestId(
      "v2-hide-btn-19-player-squads",
    ) as HTMLButtonElement;
    expect(hideBtn.disabled).toBe(false);
  });

  it("Trigger button always says 'Trigger' regardless of active state", () => {
    const { rerender } = render(
      <PlayerSquadsControl
        sessionId="S"
        viewToken="T"
        active={false}
        players={PLAYERS}
      />,
    );
    let btn = screen.getByTestId(
      "v2-retrigger-btn-19-player-squads",
    ) as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe("Trigger");

    rerender(
      <PlayerSquadsControl
        sessionId="S"
        viewToken="T"
        active={true}
        players={PLAYERS}
      />,
    );
    btn = screen.getByTestId(
      "v2-retrigger-btn-19-player-squads",
    ) as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe("Trigger");
  });

  it("Hide form posts overlayKey + sessionId for clearOverlay", () => {
    const { container } = render(
      <PlayerSquadsControl
        sessionId="S-123"
        viewToken="T"
        active={true}
        players={PLAYERS}
      />,
    );
    const form = container.querySelector(
      '[data-testid="v2-hide-form-19-player-squads"]',
    ) as HTMLFormElement;
    const overlayInput = form.querySelector(
      'input[name="overlayKey"]',
    ) as HTMLInputElement;
    expect(overlayInput.value).toBe("19-player-squads");
    const sessionInput = form.querySelector(
      'input[name="sessionId"]',
    ) as HTMLInputElement;
    expect(sessionInput.value).toBe("S-123");
  });

  it("Trigger form payload reflects the picked playerId", () => {
    const { container } = render(
      <PlayerSquadsControl sessionId="S" viewToken="T" players={PLAYERS} />,
    );
    // Default picks the first player
    let payload = (
      container.querySelector(
        '[data-testid="v2-retrigger-form-19-player-squads"] input[name="payload"]',
      ) as HTMLInputElement
    ).value;
    expect(JSON.parse(payload).playerId).toBe(PLAYERS[0].playerId);

    // Switch picker → payload reflects new pick before submit
    const picker = screen.getByTestId(
      "player-squads-control-picker",
    ) as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: PLAYERS[2].playerId } });
    payload = (
      container.querySelector(
        '[data-testid="v2-retrigger-form-19-player-squads"] input[name="payload"]',
      ) as HTMLInputElement
    ).value;
    expect(JSON.parse(payload).playerId).toBe(PLAYERS[2].playerId);
  });

  it("Trigger button is disabled when no player is picked (empty roster)", () => {
    render(
      <PlayerSquadsControl sessionId="S" viewToken="T" players={[]} />,
    );
    const btn = screen.getByTestId(
      "v2-retrigger-btn-19-player-squads",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("active=true shows the Live badge in the card header", () => {
    render(
      <PlayerSquadsControl
        sessionId="S"
        viewToken="T"
        active={true}
        players={PLAYERS}
      />,
    );
    expect(
      screen.getByTestId("v2-live-badge-19-player-squads"),
    ).toBeTruthy();
  });
});
