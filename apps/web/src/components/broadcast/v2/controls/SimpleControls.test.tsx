import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  triggerOverlayEnterAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
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
  Component: React.FC<{ sessionId: string; viewToken: string | null }>;
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
  it("renders an ENTER form + OUT form for the overlay key", () => {
    render(<Component sessionId="S" viewToken="T" />);
    expect(screen.getByTestId(`v2-enter-form-${overlayKey}`)).toBeTruthy();
    expect(screen.getByTestId(`v2-off-form-${overlayKey}`)).toBeTruthy();
  });

  it("ENTER form posts to triggerOverlayEnterAction with overlayKey + payload", () => {
    const { container } = render(<Component sessionId="S" viewToken="T" />);
    const form = container.querySelector(
      `[data-testid="v2-enter-form-${overlayKey}"]`,
    ) as HTMLFormElement;
    const overlayInput = form.querySelector(
      'input[name="overlayKey"]',
    ) as HTMLInputElement;
    expect(overlayInput.value).toBe(overlayKey);
    const payloadInput = form.querySelector(
      'input[name="payload"]',
    ) as HTMLInputElement;
    expect(payloadInput).toBeTruthy();
    // Payload must be valid JSON (server action JSON.parses it).
    expect(() => JSON.parse(payloadInput.value)).not.toThrow();
  });
});
