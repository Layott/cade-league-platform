import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  triggerOverlayEnterAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
  toggleOverlayAction: vi.fn(async () => undefined),
}));

import { BrbControl } from "./BrbControl";
import { StartingSoonControl } from "./StartingSoonControl";
import { StreamEndedControl } from "./StreamEndedControl";
import { TopScorersControl } from "./TopScorersControl";
import { OrgsControl } from "./OrgsControl";
import { CoachesControl } from "./CoachesControl";
import { PenaltiesControl } from "./PenaltiesControl";
import { LeaderboardControl } from "./LeaderboardControl";

beforeEach(() => {
  cleanup();
});

const SIMPLE_CONTROLS: Array<{
  name: string;
  Component: React.FC<{
    sessionId: string;
    viewToken: string | null;
    active?: boolean;
  }>;
  overlayKey: string;
}> = [
  { name: "BRB", Component: BrbControl, overlayKey: "01-brb" },
  {
    name: "StartingSoon",
    Component: StartingSoonControl,
    overlayKey: "12-starting-soon",
  },
  {
    name: "StreamEnded",
    Component: StreamEndedControl,
    overlayKey: "13-stream-ended",
  },
  {
    name: "TopScorers",
    Component: TopScorersControl,
    overlayKey: "14-top-scorers",
  },
  { name: "Orgs", Component: OrgsControl, overlayKey: "15-orgs" },
  { name: "Coaches", Component: CoachesControl, overlayKey: "16-coaches" },
  {
    name: "Penalties",
    Component: PenaltiesControl,
    overlayKey: "17-penalties",
  },
  {
    name: "Leaderboard",
    Component: LeaderboardControl,
    overlayKey: "07-leaderboard",
  },
];

describe.each(SIMPLE_CONTROLS)("$name", ({ Component, overlayKey }) => {
  it("renders a single toggle form for the overlay key", () => {
    render(<Component sessionId="S" viewToken="T" />);
    expect(screen.getByTestId(`v2-toggle-form-${overlayKey}`)).toBeTruthy();
  });

  it("toggle form posts overlayKey + payload + sessionId", () => {
    const { container } = render(<Component sessionId="S" viewToken="T" />);
    const form = container.querySelector(
      `[data-testid="v2-toggle-form-${overlayKey}"]`,
    ) as HTMLFormElement;
    const overlayInput = form.querySelector(
      'input[name="overlayKey"]',
    ) as HTMLInputElement;
    expect(overlayInput.value).toBe(overlayKey);
    const sessionInput = form.querySelector(
      'input[name="sessionId"]',
    ) as HTMLInputElement;
    expect(sessionInput.value).toBe("S");
    const payloadInput = form.querySelector(
      'input[name="payload"]',
    ) as HTMLInputElement;
    expect(payloadInput).toBeTruthy();
    // Payload must be valid JSON (server action JSON.parses it).
    expect(() => JSON.parse(payloadInput.value)).not.toThrow();
  });

  it("active=false renders Trigger ON label", () => {
    render(<Component sessionId="S" viewToken="T" active={false} />);
    expect(screen.getByText(/Trigger ON/i)).toBeTruthy();
  });

  it("active=true renders Trigger OFF label", () => {
    render(<Component sessionId="S" viewToken="T" active={true} />);
    expect(screen.getByText(/Trigger OFF/i)).toBeTruthy();
  });

  it("toggle form data-active flag mirrors the prop", () => {
    const { container, rerender } = render(
      <Component sessionId="S" viewToken="T" active={false} />,
    );
    let form = container.querySelector(
      `[data-testid="v2-toggle-form-${overlayKey}"]`,
    ) as HTMLFormElement;
    expect(form.getAttribute("data-active")).toBe("false");

    rerender(<Component sessionId="S" viewToken="T" active={true} />);
    form = container.querySelector(
      `[data-testid="v2-toggle-form-${overlayKey}"]`,
    ) as HTMLFormElement;
    expect(form.getAttribute("data-active")).toBe("true");
  });
});
