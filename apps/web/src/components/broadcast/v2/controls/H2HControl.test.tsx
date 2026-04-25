import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  triggerOverlayEnterAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
  toggleOverlayAction: vi.fn(async () => undefined),
  retriggerOverlayAction: vi.fn(async () => undefined),
}));

import { H2H2Control } from "./H2H2Control";
import { H2H3Control } from "./H2H3Control";
import { H2H5Control } from "./H2H5Control";

beforeEach(() => {
  cleanup();
});

describe("H2H controls", () => {
  it("H2H2 renders 2 dropdowns", () => {
    render(<H2H2Control sessionId="S" viewToken="T" />);
    expect(screen.getByTestId("v2-h2h-2-player-0")).toBeTruthy();
    expect(screen.getByTestId("v2-h2h-2-player-1")).toBeTruthy();
    expect(screen.queryByTestId("v2-h2h-2-player-2")).toBeNull();
  });

  it("H2H3 renders 3 dropdowns", () => {
    render(<H2H3Control sessionId="S" viewToken="T" />);
    for (let i = 0; i < 3; i++) {
      expect(screen.getByTestId(`v2-h2h-3-player-${i}`)).toBeTruthy();
    }
  });

  it("H2H5 renders 5 dropdowns", () => {
    render(<H2H5Control sessionId="S" viewToken="T" />);
    for (let i = 0; i < 5; i++) {
      expect(screen.getByTestId(`v2-h2h-5-player-${i}`)).toBeTruthy();
    }
  });

  it("changing a dropdown updates the payload field", () => {
    const { container } = render(
      <H2H2Control sessionId="S" viewToken="T" />,
    );
    const select = screen.getByTestId(
      "v2-h2h-2-player-0",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "faruk" } });
    const payload = (
      container.querySelector(
        'input[name="payload"]',
      ) as HTMLInputElement
    ).value;
    const parsed = JSON.parse(payload);
    expect(parsed.players[0].displayName).toBe("FARUK");
    // 2nd default unchanged
    expect(parsed.players[1].displayName).toBe("KING NONEX");
  });

  it("re-trigger refresh — payload reflects latest state across multiple changes", () => {
    const { container } = render(
      <H2H2Control sessionId="S" viewToken="T" />,
    );
    const select0 = screen.getByTestId(
      "v2-h2h-2-player-0",
    ) as HTMLSelectElement;
    const select1 = screen.getByTestId(
      "v2-h2h-2-player-1",
    ) as HTMLSelectElement;
    const getPayload = () =>
      JSON.parse(
        (
          container.querySelector(
            'input[name="payload"]',
          ) as HTMLInputElement
        ).value,
      );

    // First change → first toggle press reads this payload
    fireEvent.change(select0, { target: { value: "faruk" } });
    expect(getPayload().players[0].displayName).toBe("FARUK");

    // Second change → second toggle press must read the NEW payload, not stale
    fireEvent.change(select0, { target: { value: "anife" } });
    fireEvent.change(select1, { target: { value: "mitch" } });
    const after = getPayload();
    expect(after.players[0].displayName).toBe("ANIFE");
    expect(after.players[1].displayName).toBe("MITCH");
  });

  it("renders BOTH Trigger + Hide forms (re-trigger pattern)", () => {
    const { container } = render(
      <H2H2Control sessionId="S" viewToken="T" />,
    );
    expect(
      container.querySelector('[data-testid="v2-retrigger-form-04-h2h-2"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="v2-hide-form-04-h2h-2"]'),
    ).toBeTruthy();
  });

  it("Trigger button always says 'Trigger' regardless of active state", () => {
    const { rerender } = render(
      <H2H2Control sessionId="S" viewToken="T" active={false} />,
    );
    let btn = screen.getByTestId(
      "v2-retrigger-btn-04-h2h-2",
    ) as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe("Trigger");

    rerender(<H2H2Control sessionId="S" viewToken="T" active={true} />);
    btn = screen.getByTestId(
      "v2-retrigger-btn-04-h2h-2",
    ) as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe("Trigger");
  });

  it("active=true shows the Live badge in the card header", () => {
    render(<H2H2Control sessionId="S" viewToken="T" active={true} />);
    expect(screen.getByTestId("v2-live-badge-04-h2h-2")).toBeTruthy();
  });

  it("Hide button is disabled when inactive, enabled when active", () => {
    const { rerender } = render(
      <H2H2Control sessionId="S" viewToken="T" active={false} />,
    );
    let hideBtn = screen.getByTestId(
      "v2-hide-btn-04-h2h-2",
    ) as HTMLButtonElement;
    expect(hideBtn.disabled).toBe(true);

    rerender(<H2H2Control sessionId="S" viewToken="T" active={true} />);
    hideBtn = screen.getByTestId(
      "v2-hide-btn-04-h2h-2",
    ) as HTMLButtonElement;
    expect(hideBtn.disabled).toBe(false);
  });
});
