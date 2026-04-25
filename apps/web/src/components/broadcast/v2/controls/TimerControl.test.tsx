import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  triggerOverlayEnterAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
}));

import { TimerControl } from "./TimerControl";

beforeEach(() => {
  cleanup();
});

describe("TimerControl", () => {
  it("renders min/sec inputs + clock picker", () => {
    render(<TimerControl sessionId="S" viewToken="T" />);
    expect(screen.getByTestId("v2-timer-minutes")).toBeTruthy();
    expect(screen.getByTestId("v2-timer-seconds")).toBeTruthy();
    expect(screen.getByTestId("v2-timer-endclock")).toBeTruthy();
  });

  it("default mode is duration", () => {
    const { container } = render(
      <TimerControl sessionId="S" viewToken="T" />,
    );
    const modeEl = container.querySelector(
      "p span.text-\\[var\\(--signal\\)\\]",
    );
    expect(modeEl?.textContent).toBe("duration");
  });

  it("typing into endclock flips mode to clock", () => {
    const { container } = render(
      <TimerControl sessionId="S" viewToken="T" />,
    );
    const clock = screen.getByTestId("v2-timer-endclock") as HTMLInputElement;
    fireEvent.change(clock, { target: { value: "20:30" } });
    const modeEl = container.querySelector(
      "p span.text-\\[var\\(--signal\\)\\]",
    );
    expect(modeEl?.textContent).toBe("clock");
  });

  it("emits a payload with an ISO expiresAt string", () => {
    const { container } = render(<TimerControl sessionId="S" viewToken="T" />);
    const payload = (
      container.querySelector(
        'input[name="payload"]',
      ) as HTMLInputElement | null
    )?.value;
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(typeof parsed.expiresAt).toBe("string");
    // ISO datetime sanity — Date.parse should yield a finite timestamp.
    expect(Number.isFinite(Date.parse(parsed.expiresAt))).toBe(true);
  });
});
