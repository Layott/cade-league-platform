import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  triggerOverlayEnterAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
  toggleOverlayAction: vi.fn(async () => undefined),
  retriggerOverlayAction: vi.fn(async () => undefined),
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

  it("recomputes expiresAt at submit time, not render time (re-trigger refresh)", () => {
    const { container } = render(<TimerControl sessionId="S" viewToken="T" />);
    // Set a known duration: 3:00 (180s)
    const minutes = screen.getByTestId("v2-timer-minutes") as HTMLInputElement;
    fireEvent.change(minutes, { target: { value: "3" } });

    const form = container.querySelector(
      '[data-testid="v2-retrigger-form-02-timer"]',
    ) as HTMLFormElement;
    const payloadInput = form.querySelector(
      'input[name="payload"]',
    ) as HTMLInputElement;

    // Capture render-time expiresAt
    const renderTimeMs = Date.parse(JSON.parse(payloadInput.value).expiresAt);

    // Advance Date.now() by simulating a delay before submit.
    const realNow = Date.now;
    const offsetMs = 60_000; // 60s wait between render and click
    Date.now = () => realNow.call(Date) + offsetMs;
    try {
      // Fire submit — onSubmit handler should refresh the payload input.
      fireEvent.submit(form);
      const submitTimeMs = Date.parse(
        JSON.parse(payloadInput.value).expiresAt,
      );
      // Submit-time expiresAt must be ~offsetMs later than render-time.
      // (Tolerance accounts for JS execution lag.)
      expect(submitTimeMs - renderTimeMs).toBeGreaterThanOrEqual(
        offsetMs - 1000,
      );
    } finally {
      Date.now = realNow;
    }
  });

  it("renders BOTH Trigger + Hide forms (re-trigger pattern, not toggle)", () => {
    const { container } = render(<TimerControl sessionId="S" viewToken="T" />);
    expect(
      container.querySelector('[data-testid="v2-retrigger-form-02-timer"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="v2-hide-form-02-timer"]'),
    ).toBeTruthy();
  });

  it("Trigger button label stays 'Trigger' regardless of active state", () => {
    const { rerender } = render(
      <TimerControl sessionId="S" viewToken="T" active={false} />,
    );
    const triggerBtn1 = screen.getByTestId(
      "v2-retrigger-btn-02-timer",
    ) as HTMLButtonElement;
    expect(triggerBtn1.textContent?.trim()).toBe("Trigger");

    rerender(<TimerControl sessionId="S" viewToken="T" active={true} />);
    const triggerBtn2 = screen.getByTestId(
      "v2-retrigger-btn-02-timer",
    ) as HTMLButtonElement;
    expect(triggerBtn2.textContent?.trim()).toBe("Trigger");
  });

  it("Hide button is disabled when inactive, enabled when active", () => {
    const { rerender } = render(
      <TimerControl sessionId="S" viewToken="T" active={false} />,
    );
    const hideBtn1 = screen.getByTestId(
      "v2-hide-btn-02-timer",
    ) as HTMLButtonElement;
    expect(hideBtn1.disabled).toBe(true);

    rerender(<TimerControl sessionId="S" viewToken="T" active={true} />);
    const hideBtn2 = screen.getByTestId(
      "v2-hide-btn-02-timer",
    ) as HTMLButtonElement;
    expect(hideBtn2.disabled).toBe(false);
  });

  it("active=true renders the Live badge in the card header", () => {
    render(<TimerControl sessionId="S" viewToken="T" active={true} />);
    expect(screen.getByTestId("v2-live-badge-02-timer")).toBeTruthy();
  });

  it("active=false hides the Live badge", () => {
    render(<TimerControl sessionId="S" viewToken="T" active={false} />);
    expect(screen.queryByTestId("v2-live-badge-02-timer")).toBeNull();
  });
});
