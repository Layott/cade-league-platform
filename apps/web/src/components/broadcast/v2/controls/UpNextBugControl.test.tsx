import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  triggerOverlayEnterAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
  toggleOverlayAction: vi.fn(async () => undefined),
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

  it("toggle button is disabled when no upcoming matches", () => {
    render(
      <UpNextBugControl sessionId="S" viewToken="T" upcoming={[]} />,
    );
    const toggleBtn = screen.getByTestId(
      "v2-toggle-btn-10-up-next-bug",
    ) as HTMLButtonElement;
    expect(toggleBtn.disabled).toBe(true);
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

  it("re-trigger refresh — switching back and forth updates payload each time", () => {
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
    const getPayload = () =>
      JSON.parse(
        (
          container.querySelector(
            'input[name="payload"]',
          ) as HTMLInputElement
        ).value,
      );

    // Initial = m1 (FARUK vs ANIFE)
    expect(getPayload().home.displayName).toBe("FARUK");

    // Switch to m2 (BAJI JNR vs KING NONEX)
    fireEvent.change(select, { target: { value: "m2" } });
    expect(getPayload().home.displayName).toBe("BAJI JNR");

    // Switch BACK to m1 — payload must reflect m1 again, not stale m2
    fireEvent.change(select, { target: { value: "m1" } });
    const after = getPayload();
    expect(after.home.displayName).toBe("FARUK");
    expect(after.away.displayName).toBe("ANIFE");
    expect(after.kickoffAt).toBe("2026-04-25T19:00:00Z");
  });

  it("active=true flips toggle button to OFF state", () => {
    render(
      <UpNextBugControl
        sessionId="S"
        viewToken="T"
        upcoming={UPCOMING}
        active={true}
      />,
    );
    expect(screen.getByText(/Trigger OFF/i)).toBeTruthy();
  });
});
