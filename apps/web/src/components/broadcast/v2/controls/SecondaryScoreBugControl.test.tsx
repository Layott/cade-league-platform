import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  triggerOverlayEnterAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
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
});
