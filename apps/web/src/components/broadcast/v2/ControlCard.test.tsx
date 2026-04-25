import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ControlCard } from "./ControlCard";

beforeEach(() => {
  cleanup();
});

describe("ControlCard", () => {
  it("renders the overlay label + key number", () => {
    render(
      <ControlCard
        overlayKey="01-brb"
        sessionId="S1"
        viewToken="TOK"
        triggerSlot={<button>ENTER</button>}
      />,
    );
    expect(screen.getByText(/BRB/i)).toBeTruthy();
    expect(screen.getByText("#01")).toBeTruthy();
  });

  it("exposes the copy URL + open ↗ buttons", () => {
    render(
      <ControlCard
        overlayKey="07-leaderboard"
        sessionId="S2"
        viewToken="TOK"
        triggerSlot={<span data-testid="footer">slot</span>}
      />,
    );
    expect(screen.getByTestId("v2-copy-07-leaderboard")).toBeTruthy();
    expect(screen.getByTestId("v2-open-07-leaderboard")).toBeTruthy();
  });

  it("renders the lazy-mount stage with a data-mounted flag", () => {
    const { container } = render(
      <ControlCard
        overlayKey="02-timer"
        sessionId="S3"
        viewToken={null}
        triggerSlot={<span>x</span>}
      />,
    );
    const stage = container.querySelector(
      '[data-testid="v2-preview-stage-02-timer"]',
    );
    expect(stage).toBeTruthy();
    // The flag is either "true" (fallback timer + sync IO already fired)
    // or "false" (waiting for visibility) — both are valid lifecycle
    // states for the lazy-mount controller. We only assert the attribute
    // is present.
    expect(stage?.getAttribute("data-mounted")).toMatch(/^(true|false)$/);
  });

  it("renders the editPanel when supplied", () => {
    render(
      <ControlCard
        overlayKey="08-lower-third"
        sessionId="S4"
        viewToken={null}
        editPanel={<div data-testid="my-panel">panel</div>}
        triggerSlot={<span>x</span>}
      />,
    );
    expect(screen.getByTestId("v2-edit-08-lower-third")).toBeTruthy();
    expect(screen.getByTestId("my-panel")).toBeTruthy();
  });

  it("open ↗ link points at the live overlay URL (no preview=1)", () => {
    render(
      <ControlCard
        overlayKey="14-top-scorers"
        sessionId="S5"
        viewToken="TT"
        triggerSlot={<span>x</span>}
      />,
    );
    const a = screen.getByTestId("v2-open-14-top-scorers") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe(
      "/overlay/v2/14-top-scorers?session=S5&token=TT",
    );
  });
});
