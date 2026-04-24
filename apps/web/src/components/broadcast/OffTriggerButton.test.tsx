import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OffTriggerButton } from "./OffTriggerButton";

// The server-actions referenced by the form `action` attribute are async
// function references; in JSDOM the form never actually submits. We only
// need to assert the markup routes to the right action symbol via hidden
// inputs + disabled state.

vi.mock("@/app/admin/broadcast/actions", () => ({
  clearOverlayAction: vi.fn(),
  clearInstanceAction: vi.fn(),
  clearScoreBugAction: vi.fn(),
}));

describe("OffTriggerButton", () => {
  it("score_bug form carries slot + no eventId", () => {
    render(
      <OffTriggerButton
        templateKey="score_bug"
        sessionId="s1"
        slot="secondary"
      />,
    );
    const btn = screen.getByTestId("off-score_bug");
    expect(btn).toBeTruthy();
    const form = btn.closest("form")!;
    const hidden = Array.from(form.querySelectorAll("input"));
    const slotInput = hidden.find((i) => i.name === "slot");
    expect(slotInput?.value).toBe("secondary");
    // no eventId should be rendered for score_bug
    expect(hidden.find((i) => i.name === "eventId")).toBeUndefined();
  });

  it("multi-instance (lower_third) disables when no instanceId", () => {
    render(
      <OffTriggerButton
        templateKey="lower_third"
        sessionId="s1"
      />,
    );
    const btn = screen.getByTestId("off-lower_third") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("multi-instance (lower_third) enabled with instanceId", () => {
    render(
      <OffTriggerButton
        templateKey="lower_third"
        sessionId="s1"
        instanceId="inst-42"
      />,
    );
    const btn = screen.getByTestId("off-lower_third") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    const form = btn.closest("form")!;
    const instanceIdInput = form.querySelector<HTMLInputElement>(
      "input[name=instanceId]",
    );
    expect(instanceIdInput?.value).toBe("inst-42");
  });

  it("single-instance (stinger_goal) uses eventId + disables when missing", () => {
    const { rerender } = render(
      <OffTriggerButton templateKey="stinger_goal" sessionId="s" />,
    );
    let btn = screen.getByTestId("off-stinger_goal") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    rerender(
      <OffTriggerButton
        templateKey="stinger_goal"
        sessionId="s"
        latestEventId="ev-9"
      />,
    );
    btn = screen.getByTestId("off-stinger_goal") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    const form = btn.closest("form")!;
    const evInput = form.querySelector<HTMLInputElement>("input[name=eventId]");
    expect(evInput?.value).toBe("ev-9");
  });

  it("up_next_bug routes through single-instance clearOverlayAction", () => {
    // Plan 48.4 — up_next_bug triggers via overlay_events (single), so OFF
    // must hit clearOverlayAction with eventId (NOT clearInstanceAction
    // with instanceId — previous routing left the button disabled + did
    // nothing because overlay_active_instances had no row).
    render(
      <OffTriggerButton
        templateKey="up_next_bug"
        sessionId="s"
        latestEventId="ev-up-1"
      />,
    );
    const btn = screen.getByTestId("off-up_next_bug") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    const form = btn.closest("form") as HTMLFormElement;
    const evInput = form.querySelector<HTMLInputElement>(
      "input[name=eventId]",
    );
    expect(evInput?.value).toBe("ev-up-1");
    expect(form.querySelector("input[name=instanceId]")).toBeNull();
  });

  it("layout_timer routes through single-instance clearOverlayAction", () => {
    render(
      <OffTriggerButton
        templateKey="layout_timer"
        sessionId="s"
        latestEventId="ev-timer-1"
      />,
    );
    const btn = screen.getByTestId("off-layout_timer") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    const form = btn.closest("form") as HTMLFormElement;
    const evInput = form.querySelector<HTMLInputElement>(
      "input[name=eventId]",
    );
    expect(evInput?.value).toBe("ev-timer-1");
    expect(form.querySelector("input[name=instanceId]")).toBeNull();
  });
});
