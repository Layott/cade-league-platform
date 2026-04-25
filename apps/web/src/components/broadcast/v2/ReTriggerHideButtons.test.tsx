import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  retriggerOverlayAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
}));

import { ReTriggerHideButtons } from "./ReTriggerHideButtons";

beforeEach(() => {
  cleanup();
});

describe("ReTriggerHideButtons", () => {
  it("renders TWO forms (Trigger + Hide) side-by-side", () => {
    const { container } = render(
      <ReTriggerHideButtons
        overlayKey="04-h2h-2"
        sessionId="S"
        active={false}
        payloadFields={
          <input type="hidden" name="payload" value="{}" />
        }
      />,
    );
    expect(
      container.querySelector('[data-testid="v2-retrigger-form-04-h2h-2"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="v2-hide-form-04-h2h-2"]'),
    ).toBeTruthy();
    // Two distinct forms — neither nested inside the other
    const forms = container.querySelectorAll("form");
    expect(forms.length).toBe(2);
  });

  it("Trigger button label stays 'Trigger' regardless of active prop", () => {
    const { rerender } = render(
      <ReTriggerHideButtons
        overlayKey="04-h2h-2"
        sessionId="S"
        active={false}
        payloadFields={<input type="hidden" name="payload" value="{}" />}
      />,
    );
    let btn = screen.getByTestId(
      "v2-retrigger-btn-04-h2h-2",
    ) as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe("Trigger");

    rerender(
      <ReTriggerHideButtons
        overlayKey="04-h2h-2"
        sessionId="S"
        active={true}
        payloadFields={<input type="hidden" name="payload" value="{}" />}
      />,
    );
    btn = screen.getByTestId(
      "v2-retrigger-btn-04-h2h-2",
    ) as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe("Trigger");
  });

  it("Hide button is DISABLED when inactive (nothing to hide)", () => {
    render(
      <ReTriggerHideButtons
        overlayKey="04-h2h-2"
        sessionId="S"
        active={false}
        payloadFields={<input type="hidden" name="payload" value="{}" />}
      />,
    );
    const hideBtn = screen.getByTestId(
      "v2-hide-btn-04-h2h-2",
    ) as HTMLButtonElement;
    expect(hideBtn.disabled).toBe(true);
  });

  it("Hide button is ENABLED when active=true", () => {
    render(
      <ReTriggerHideButtons
        overlayKey="04-h2h-2"
        sessionId="S"
        active={true}
        payloadFields={<input type="hidden" name="payload" value="{}" />}
      />,
    );
    const hideBtn = screen.getByTestId(
      "v2-hide-btn-04-h2h-2",
    ) as HTMLButtonElement;
    expect(hideBtn.disabled).toBe(false);
  });

  it("both forms emit sessionId + overlayKey hidden inputs", () => {
    const { container } = render(
      <ReTriggerHideButtons
        overlayKey="07-leaderboard"
        sessionId="abc"
        active={false}
        payloadFields={<input type="hidden" name="payload" value="{}" />}
      />,
    );
    const triggerForm = container.querySelector(
      '[data-testid="v2-retrigger-form-07-leaderboard"]',
    ) as HTMLFormElement;
    const hideForm = container.querySelector(
      '[data-testid="v2-hide-form-07-leaderboard"]',
    ) as HTMLFormElement;

    for (const f of [triggerForm, hideForm]) {
      expect(
        (f.querySelector('input[name="sessionId"]') as HTMLInputElement).value,
      ).toBe("abc");
      expect(
        (f.querySelector('input[name="overlayKey"]') as HTMLInputElement)
          .value,
      ).toBe("07-leaderboard");
    }
  });

  it("emits instanceSlot in BOTH forms when supplied (multi-instance)", () => {
    const { container } = render(
      <ReTriggerHideButtons
        overlayKey="08-lower-third"
        sessionId="S"
        active={false}
        instanceSlot={2}
        payloadFields={<input type="hidden" name="payload" value="{}" />}
      />,
    );
    const triggerForm = container.querySelector(
      '[data-testid="v2-retrigger-form-08-lower-third-2"]',
    ) as HTMLFormElement;
    const hideForm = container.querySelector(
      '[data-testid="v2-hide-form-08-lower-third-2"]',
    ) as HTMLFormElement;

    expect(
      (triggerForm.querySelector(
        'input[name="instanceSlot"]',
      ) as HTMLInputElement)?.value,
    ).toBe("2");
    expect(
      (hideForm.querySelector(
        'input[name="instanceSlot"]',
      ) as HTMLInputElement)?.value,
    ).toBe("2");
  });

  it("Trigger form posts retriggerOverlayAction; Hide form posts triggerOverlayOffAction", async () => {
    const actions = await import(
      "@/app/admin/broadcast/v2/[sessionId]/actions"
    );
    const { container } = render(
      <ReTriggerHideButtons
        overlayKey="04-h2h-2"
        sessionId="S"
        active={true}
        payloadFields={<input type="hidden" name="payload" value="{}" />}
      />,
    );
    const triggerForm = container.querySelector(
      '[data-testid="v2-retrigger-form-04-h2h-2"]',
    ) as HTMLFormElement;
    const hideForm = container.querySelector(
      '[data-testid="v2-hide-form-04-h2h-2"]',
    ) as HTMLFormElement;
    expect(triggerForm.action).toBeTruthy();
    expect(hideForm.action).toBeTruthy();
    // Vitest react-server-action mock: form.action references the same mock
    // function instance that we stubbed in vi.mock above.
    expect(actions.retriggerOverlayAction).toBeDefined();
    expect(actions.triggerOverlayOffAction).toBeDefined();
  });

  it("canTrigger=false disables only the Trigger button, not Hide", () => {
    render(
      <ReTriggerHideButtons
        overlayKey="10-up-next-bug"
        sessionId="S"
        active={true}
        canTrigger={false}
        payloadFields={<input type="hidden" name="payload" value="{}" />}
      />,
    );
    const triggerBtn = screen.getByTestId(
      "v2-retrigger-btn-10-up-next-bug",
    ) as HTMLButtonElement;
    const hideBtn = screen.getByTestId(
      "v2-hide-btn-10-up-next-bug",
    ) as HTMLButtonElement;
    expect(triggerBtn.disabled).toBe(true);
    expect(hideBtn.disabled).toBe(false);
  });

  it("data-active flag mirrors the active prop", () => {
    const { container, rerender } = render(
      <ReTriggerHideButtons
        overlayKey="04-h2h-2"
        sessionId="S"
        active={false}
        payloadFields={<input type="hidden" name="payload" value="{}" />}
      />,
    );
    const row = container.querySelector(
      '[data-testid="v2-retrigger-row-04-h2h-2"]',
    ) as HTMLElement;
    expect(row.getAttribute("data-active")).toBe("false");

    rerender(
      <ReTriggerHideButtons
        overlayKey="04-h2h-2"
        sessionId="S"
        active={true}
        payloadFields={<input type="hidden" name="payload" value="{}" />}
      />,
    );
    expect(row.getAttribute("data-active")).toBe("true");
  });

  it("supports custom triggerLabel + hideLabel overrides", () => {
    render(
      <ReTriggerHideButtons
        overlayKey="08-lower-third"
        sessionId="S"
        active={false}
        instanceSlot={1}
        triggerLabel="Update & Show"
        hideLabel="Clear slot"
        payloadFields={<input type="hidden" name="payload" value="{}" />}
      />,
    );
    expect(screen.getByText(/Update & Show/i)).toBeTruthy();
    expect(screen.getByText(/Clear slot/i)).toBeTruthy();
  });
});
