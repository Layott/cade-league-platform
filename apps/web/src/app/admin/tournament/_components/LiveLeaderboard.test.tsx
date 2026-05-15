import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LiveLeaderboard, type LeaderboardRow } from "./LiveLeaderboard";

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span data-stub-image>{alt}</span>,
}));

vi.mock("@/lib/player-photos", () => ({
  getPlayerAvatarUrl: () => null,
}));

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    channel: () => ({
      on: () => ({ on: () => ({ on: () => ({ subscribe: () => undefined }) }) }),
      subscribe: () => undefined,
    }),
    removeChannel: () => undefined,
  }),
}));

afterEach(() => cleanup());

const ROWS: LeaderboardRow[] = [
  {
    pos: 1,
    playerId: "p1",
    name: "Alpha",
    gamerTag: "ALPHA",
    played: 5,
    wins: 4,
    draws: 1,
    losses: 0,
    gf: 14,
    ga: 4,
    gd: 10,
    pts: 13,
    form: "WWWDW",
    pointsAdj: 0,
    gdAdj: 0,
  },
  {
    pos: 2,
    playerId: "p2",
    name: "Beta",
    gamerTag: "BETA",
    played: 5,
    wins: 1,
    draws: 1,
    losses: 3,
    gf: 4,
    ga: 11,
    gd: -7,
    pts: 4,
    form: "LDLLW",
    pointsAdj: -3,
    gdAdj: 0,
  },
];

describe("LiveLeaderboard", () => {
  it("renders an empty-shell when seasonId is null", () => {
    render(<LiveLeaderboard seasonId={null} initialRows={[]} />);
    expect(
      screen.getByText(/No active season/i),
    ).toBeTruthy();
  });

  it("renders one row per player", () => {
    render(<LiveLeaderboard seasonId="s1" initialRows={ROWS} />);
    expect(screen.getByTestId("standings-row-p1")).toBeTruthy();
    expect(screen.getByTestId("standings-row-p2")).toBeTruthy();
  });

  it("renders +N for positive GD", () => {
    render(<LiveLeaderboard seasonId="s1" initialRows={ROWS} />);
    expect(screen.getByText("+10")).toBeTruthy();
  });

  it("renders sanction badge for negative pointsAdj", () => {
    // 2026-05-15 — DED column replaced the under-name `-3pts` chip with a
    // dedicated cell. Badge text now lives inside the new column and uses
    // the canonical "−N pts" form (positive magnitude + en-dash) so points
    // + GD deductions can share the same formatting.
    render(<LiveLeaderboard seasonId="s1" initialRows={ROWS} />);
    const badge = screen.getByTestId("sanction-badge");
    expect(badge.textContent).toContain("−3 pts");
  });

  it("renders form pills with correct letters", () => {
    render(<LiveLeaderboard seasonId="s1" initialRows={ROWS} />);
    const tableRow = screen.getByTestId("standings-row-p1");
    expect(tableRow.querySelector("[aria-label='Form W,W,W,D,W']")).toBeTruthy();
  });

  it("renders empty state when there are no rows", () => {
    render(<LiveLeaderboard seasonId="s1" initialRows={[]} />);
    expect(
      screen.getByText(/No standings rows yet/i),
    ).toBeTruthy();
  });

  it("renders W-D-L summary", () => {
    render(<LiveLeaderboard seasonId="s1" initialRows={ROWS} />);
    expect(screen.getByText("4-1-0")).toBeTruthy();
  });
});
