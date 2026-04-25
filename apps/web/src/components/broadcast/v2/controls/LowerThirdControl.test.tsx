import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

// Server actions are imported by the component; vitest can't resolve the
// real "use server" file in jsdom, so stub them out before importing the
// SUT.
vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  triggerOverlayEnterAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
  toggleOverlayAction: vi.fn(async () => undefined),
  retriggerOverlayAction: vi.fn(async () => undefined),
}));

import { LowerThirdControl } from "./LowerThirdControl";

const SESSION_ID = "session-1";
const VIEW_TOKEN = "token-1";

// jsdom 29 in this workspace exposes a stub `localStorage` whose methods
// are missing. Replace it with a minimal in-memory implementation so the
// preset save/load tests can run.
function installFakeLocalStorage(): void {
  const store = new Map<string, string>();
  const fake: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, String(v));
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: fake,
    configurable: true,
  });
}

beforeEach(() => {
  cleanup();
  installFakeLocalStorage();
});

describe("LowerThirdControl", () => {
  it("renders 3 slots + 3 Trigger + 3 Hide buttons (one pair per slot)", () => {
    render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
      />,
    );
    expect(screen.getByTestId("v2-lt-slot-1")).toBeTruthy();
    expect(screen.getByTestId("v2-lt-slot-2")).toBeTruthy();
    expect(screen.getByTestId("v2-lt-slot-3")).toBeTruthy();
    expect(screen.getByTestId("v2-lt-trigger-1")).toBeTruthy();
    expect(screen.getByTestId("v2-lt-trigger-2")).toBeTruthy();
    expect(screen.getByTestId("v2-lt-trigger-3")).toBeTruthy();
    expect(screen.getByTestId("v2-lt-hide-1")).toBeTruthy();
    expect(screen.getByTestId("v2-lt-hide-2")).toBeTruthy();
    expect(screen.getByTestId("v2-lt-hide-3")).toBeTruthy();
  });

  it("each slot's re-trigger form carries the correct instanceSlot field", () => {
    const { container } = render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
      />,
    );
    const form1 = container.querySelector(
      '[data-testid="v2-retrigger-form-08-lower-third-1"]',
    ) as HTMLFormElement;
    const form2 = container.querySelector(
      '[data-testid="v2-retrigger-form-08-lower-third-2"]',
    ) as HTMLFormElement;
    expect(
      (form1.querySelector('input[name="instanceSlot"]') as HTMLInputElement)
        ?.value,
    ).toBe("1");
    expect(
      (form2.querySelector('input[name="instanceSlot"]') as HTMLInputElement)
        ?.value,
    ).toBe("2");
  });

  it("each slot's hide form carries the correct instanceSlot field", () => {
    const { container } = render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
      />,
    );
    const hideForm1 = container.querySelector(
      '[data-testid="v2-hide-form-08-lower-third-1"]',
    ) as HTMLFormElement;
    const hideForm3 = container.querySelector(
      '[data-testid="v2-hide-form-08-lower-third-3"]',
    ) as HTMLFormElement;
    expect(
      (
        hideForm1.querySelector(
          'input[name="instanceSlot"]',
        ) as HTMLInputElement
      )?.value,
    ).toBe("1");
    expect(
      (
        hideForm3.querySelector(
          'input[name="instanceSlot"]',
        ) as HTMLInputElement
      )?.value,
    ).toBe("3");
  });

  it("payload field for slot 1 contains a UUID-shaped playerId + name + tag", () => {
    const { container } = render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
      />,
    );
    const form1 = container.querySelector(
      '[data-testid="v2-retrigger-form-08-lower-third-1"]',
    ) as HTMLFormElement;
    const payloadInput = form1.querySelector(
      'input[name="payload"]',
    ) as HTMLInputElement;
    const parsed = JSON.parse(payloadInput.value);
    expect(parsed.playerId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(parsed.displayName).toBe("JOSH");
    expect(parsed.gamerTag).toBe("HEAD CASTER");
    expect(parsed.jerseyNumber).toBe(1);
  });

  it("typing into slot 1 updates the payload value", () => {
    const { container } = render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
      />,
    );
    const nameInput = screen.getByTestId("v2-lt-name-1") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "ZARA" } });

    const form1 = container.querySelector(
      '[data-testid="v2-retrigger-form-08-lower-third-1"]',
    ) as HTMLFormElement;
    const payloadInput = form1.querySelector(
      'input[name="payload"]',
    ) as HTMLInputElement;
    const parsed = JSON.parse(payloadInput.value);
    expect(parsed.displayName).toBe("ZARA");
  });

  it("re-trigger refresh — multi-edit slot reflects latest name+role each time", () => {
    const { container } = render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
      />,
    );
    const nameInput = screen.getByTestId("v2-lt-name-1") as HTMLInputElement;
    const roleInput = screen.getByTestId("v2-lt-role-1") as HTMLInputElement;
    const getPayload = () => {
      const form1 = container.querySelector(
        '[data-testid="v2-retrigger-form-08-lower-third-1"]',
      ) as HTMLFormElement;
      return JSON.parse(
        (
          form1.querySelector('input[name="payload"]') as HTMLInputElement
        ).value,
      );
    };

    // Initial → JOSH / HEAD CASTER
    expect(getPayload().displayName).toBe("JOSH");

    // First edit
    fireEvent.change(nameInput, { target: { value: "ZARA" } });
    fireEvent.change(roleInput, { target: { value: "PIT REPORTER" } });
    expect(getPayload().displayName).toBe("ZARA");
    expect(getPayload().gamerTag).toBe("PIT REPORTER");

    // Second edit — re-trigger MUST send fresh payload, not stale ZARA/PIT
    fireEvent.change(nameInput, { target: { value: "MILEY" } });
    fireEvent.change(roleInput, { target: { value: "GUEST" } });
    const after = getPayload();
    expect(after.displayName).toBe("MILEY");
    expect(after.gamerTag).toBe("GUEST");
    // playerId + jerseyNumber stay anchored to slot 1
    expect(after.jerseyNumber).toBe(1);
  });

  it("preset save persists to localStorage[cade-lt-presets]", () => {
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValue("MD3-introductions");

    render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
      />,
    );

    const saveBtn = screen.getByTestId("v2-lt-preset-save-1");
    fireEvent.click(saveBtn);

    const raw = window.localStorage.getItem("cade-lt-presets");
    expect(raw).toBeTruthy();
    const list = JSON.parse(raw!);
    expect(list).toEqual([
      {
        name: "MD3-introductions",
        slotData: { name: "JOSH", role: "HEAD CASTER" },
      },
    ]);

    promptSpy.mockRestore();
  });

  it("preset load populates inputs from localStorage", () => {
    window.localStorage.setItem(
      "cade-lt-presets",
      JSON.stringify([
        { name: "TEST", slotData: { name: "MILEY", role: "GUEST" } },
      ]),
    );

    render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
      />,
    );

    const select = screen.getByTestId(
      "v2-lt-preset-load-1",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "TEST" } });

    const nameInput = screen.getByTestId("v2-lt-name-1") as HTMLInputElement;
    expect(nameInput.value).toBe("MILEY");
    const roleInput = screen.getByTestId("v2-lt-role-1") as HTMLInputElement;
    expect(roleInput.value).toBe("GUEST");
  });

  it("Trigger button text stays 'Trigger' regardless of slot active state", () => {
    render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slotsActive={[true, false, true]}
      />,
    );
    const trigger1 = screen.getByTestId("v2-lt-trigger-1") as HTMLButtonElement;
    const trigger2 = screen.getByTestId("v2-lt-trigger-2") as HTMLButtonElement;
    const trigger3 = screen.getByTestId("v2-lt-trigger-3") as HTMLButtonElement;
    expect(trigger1.textContent?.trim()).toBe("Trigger");
    expect(trigger2.textContent?.trim()).toBe("Trigger");
    expect(trigger3.textContent?.trim()).toBe("Trigger");
  });

  it("Hide buttons mirror per-slot active state (disabled when slot is inactive)", () => {
    render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slotsActive={[true, false, true]}
      />,
    );
    const hide1 = screen.getByTestId("v2-lt-hide-1") as HTMLButtonElement;
    const hide2 = screen.getByTestId("v2-lt-hide-2") as HTMLButtonElement;
    const hide3 = screen.getByTestId("v2-lt-hide-3") as HTMLButtonElement;
    expect(hide1.disabled).toBe(false);
    expect(hide2.disabled).toBe(true);
    expect(hide3.disabled).toBe(false);
  });

  it("slot-level Live badge surfaces per-slot active state", () => {
    render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slotsActive={[true, false, true]}
      />,
    );
    expect(screen.getByTestId("v2-lt-live-1")).toBeTruthy();
    expect(screen.queryByTestId("v2-lt-live-2")).toBeNull();
    expect(screen.getByTestId("v2-lt-live-3")).toBeTruthy();
  });

  it("card-level Live badge appears when ANY slot is active", () => {
    const { rerender } = render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slotsActive={[false, false, false]}
      />,
    );
    expect(screen.queryByTestId("v2-live-badge-08-lower-third")).toBeNull();

    rerender(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slotsActive={[false, true, false]}
      />,
    );
    expect(screen.getByTestId("v2-live-badge-08-lower-third")).toBeTruthy();
  });
});
