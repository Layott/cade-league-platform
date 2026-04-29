import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { H2HComparisonCard, type H2HCard } from "./H2HComparisonCard";

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span data-stub-image>{alt}</span>,
}));

vi.mock("@/lib/player-photos", () => ({
  getPlayerAvatarUrl: () => null,
}));

afterEach(() => cleanup());

// 2026-04-28 (Bug #14): winProbPct is now an INTEGER PERCENT in [0..100]
// — endpoint pre-multiplies by 100 + rounds. Was previously a fraction
// (0..1). The card just renders `.toFixed(1)%` directly.
const CARD: H2HCard = {
  playerId: "p1",
  name: "Alpha",
  gamerTag: "ALPHA",
  pos: 3,
  played: 5,
  wins: 3,
  draws: 1,
  losses: 1,
  gf: 12,
  ga: 6,
  gd: 6,
  pts: 10,
  winProbPct: 62.4,
};

describe("H2HComparisonCard", () => {
  it("shows the player's name + gamer tag + position label", () => {
    render(<H2HComparisonCard card={CARD} />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("ALPHA")).toBeTruthy();
    expect(screen.getByText("#3")).toBeTruthy();
  });

  it("formats wins-draws-losses", () => {
    render(<H2HComparisonCard card={CARD} />);
    expect(screen.getByText("3-1-1")).toBeTruthy();
  });

  it("renders win-probability as a percentage with one decimal", () => {
    render(<H2HComparisonCard card={CARD} />);
    expect(screen.getByTestId("win-prob-pct").textContent).toBe("62.4%");
  });

  it("formats positive GD with a leading +", () => {
    render(<H2HComparisonCard card={CARD} />);
    expect(screen.getByText("+6")).toBeTruthy();
  });

  it("falls back to em-dash for missing position", () => {
    render(<H2HComparisonCard card={{ ...CARD, pos: null }} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("renders a non-zero played value", () => {
    render(<H2HComparisonCard card={CARD} />);
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("renders the testid wrapper", () => {
    render(<H2HComparisonCard card={CARD} />);
    expect(screen.getByTestId(`h2h-card-${CARD.playerId}`)).toBeTruthy();
  });
});
