import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  triggerOverlayEnterAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
}));

import { UpNextBugControl } from "./UpNextBugControl";

const UPCOMING = [
  {
    matchId: "m1",
    homeName: "FARUK",
    awayName: "ANIFE",
    kickoffAt: "2026-04-25T19:00:00Z",
  },
  {
    matchId: "m2",
    homeName: "BAJI JNR",
    awayName: "KING NONEX",
    kickoffAt: "2026-04-25T20:00:00Z",
  },
];

beforeEach(() => {
  cleanup();
});

describe("UpNextBugControl", () => {
  it("renders the match dropdown when matches are available", () => {
    render(
      <UpNextBugControl
        sessionId="S"
        viewToken="T"
        upcoming={UPCOMING}
      />,
    );
    expect(screen.getByTestId("v2-upnext-match")).toBeTruthy();
    expect(screen.getByText("FARUK vs ANIFE")).toBeTruthy();
  });

  it("renders empty-state when no upcoming matches", () => {
    render(
      <UpNextBugControl sessionId="S" viewToken="T" upcoming={[]} />,
    );
    expect(screen.queryByTestId("v2-upnext-match")).toBeNull();
    expect(screen.getByText(/No upcoming matches/i)).toBeTruthy();
  });

  it("ENTER button is disabled when no upcoming matches", () => {
    render(
      <UpNextBugControl sessionId="S" viewToken="T" upcoming={[]} />,
    );
    const enterBtn = screen.getByTestId(
      "v2-enter-btn-10-up-next-bug",
    ) as HTMLButtonElement;
    expect(enterBtn.disabled).toBe(true);
  });

  it("payload carries home/away/kickoffAt from the selected match", () => {
    const { container } = render(
      <UpNextBugControl
        sessionId="S"
        viewToken="T"
        upcoming={UPCOMING}
      />,
    );
    const select = screen.getByTestId(
      "v2-upnext-match",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "m2" } });

    const payload = (
      container.querySelector(
        'input[name="payload"]',
      ) as HTMLInputElement
    ).value;
    const parsed = JSON.parse(payload);
    expect(parsed.home.displayName).toBe("BAJI JNR");
    expect(parsed.away.displayName).toBe("KING NONEX");
    expect(parsed.kickoffAt).toBe("2026-04-25T20:00:00Z");
  });
});
