import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  toggleOverlayAction: vi.fn(async () => undefined),
}));

import { ToggleTriggerButton } from "./ToggleTriggerButton";

beforeEach(() => {
  cleanup();
});

describe("ToggleTriggerButton", () => {
  it("renders 'Trigger ON' label when inactive (PrimaryButton)", () => {
    render(
      <ToggleTriggerButton
        overlayKey="01-brb"
        sessionId="S"
        active={false}
      />,
    );
    expect(screen.getByText(/Trigger ON/i)).toBeTruthy();
  });

  it("renders 'Trigger OFF' label when active (DangerButton)", () => {
    render(
      <ToggleTriggerButton
        overlayKey="01-brb"
        sessionId="S"
        active={true}
      />,
    );
    expect(screen.getByText(/Trigger OFF/i)).toBeTruthy();
  });

  it("emits sessionId + overlayKey hidden inputs", () => {
    const { container } = render(
      <ToggleTriggerButton
        overlayKey="07-leaderboard"
        sessionId="abc"
        active={false}
        payloadFields={
          <input type="hidden" name="payload" value="{}" />
        }
      />,
    );
    const sessionInput = container.querySelector(
      'input[name="sessionId"]',
    ) as HTMLInputElement;
    const overlayInput = container.querySelector(
      'input[name="overlayKey"]',
    ) as HTMLInputElement;
    expect(sessionInput.value).toBe("abc");
    expect(overlayInput.value).toBe("07-leaderboard");
  });

  it("emits instanceSlot when supplied (multi-instance)", () => {
    const { container } = render(
      <ToggleTriggerButton
        overlayKey="08-lower-third"
        sessionId="S"
        active={false}
        instanceSlot={2}
      />,
    );
    const slotInput = container.querySelector(
      'input[name="instanceSlot"]',
    ) as HTMLInputElement;
    expect(slotInput?.value).toBe("2");
  });

  it("does NOT emit instanceSlot when not supplied", () => {
    const { container } = render(
      <ToggleTriggerButton
        overlayKey="01-brb"
        sessionId="S"
        active={false}
      />,
    );
    expect(container.querySelector('input[name="instanceSlot"]')).toBeNull();
  });

  it("disables the button when inactive AND canEnter=false", () => {
    render(
      <ToggleTriggerButton
        overlayKey="10-up-next-bug"
        sessionId="S"
        active={false}
        canEnter={false}
      />,
    );
    const btn = screen.getByTestId(
      "v2-toggle-btn-10-up-next-bug",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("does NOT disable the button when active even if canEnter=false", () => {
    // Operator must always be able to clear an active overlay regardless
    // of canEnter (which only gates ENTER).
    render(
      <ToggleTriggerButton
        overlayKey="10-up-next-bug"
        sessionId="S"
        active={true}
        canEnter={false}
      />,
    );
    const btn = screen.getByTestId(
      "v2-toggle-btn-10-up-next-bug",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("data-active flag mirrors the active prop", () => {
    const { container, rerender } = render(
      <ToggleTriggerButton
        overlayKey="01-brb"
        sessionId="S"
        active={false}
      />,
    );
    const form = container.querySelector(
      '[data-testid="v2-toggle-form-01-brb"]',
    ) as HTMLFormElement;
    expect(form.getAttribute("data-active")).toBe("false");

    rerender(
      <ToggleTriggerButton
        overlayKey="01-brb"
        sessionId="S"
        active={true}
      />,
    );
    expect(form.getAttribute("data-active")).toBe("true");
  });

  it("supports custom onLabel + offLabel overrides", () => {
    const { rerender } = render(
      <ToggleTriggerButton
        overlayKey="08-lower-third"
        sessionId="S"
        active={false}
        instanceSlot={1}
        onLabel="Update & Show"
        offLabel="Hide"
      />,
    );
    expect(screen.getByText(/Update & Show/i)).toBeTruthy();

    rerender(
      <ToggleTriggerButton
        overlayKey="08-lower-third"
        sessionId="S"
        active={true}
        instanceSlot={1}
        onLabel="Update & Show"
        offLabel="Hide"
      />,
    );
    expect(screen.getByText(/^Hide$/i)).toBeTruthy();
  });
});
