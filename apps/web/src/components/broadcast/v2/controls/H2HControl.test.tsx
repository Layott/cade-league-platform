import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  triggerOverlayEnterAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
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

    // First change → first "ENTER" reads this payload
    fireEvent.change(select0, { target: { value: "faruk" } });
    expect(getPayload().players[0].displayName).toBe("FARUK");

    // Second change → second "ENTER" must read the NEW payload, not stale
    fireEvent.change(select0, { target: { value: "anife" } });
    fireEvent.change(select1, { target: { value: "mitch" } });
    const after = getPayload();
    expect(after.players[0].displayName).toBe("ANIFE");
    expect(after.players[1].displayName).toBe("MITCH");
  });
});
