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

describe("LowerThirdControl (per-slot card)", () => {
  it("renders one slot card with its own Trigger + Hide buttons", () => {
    render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={1}
      />,
    );
    expect(screen.getByTestId("v2-lt-slot-1")).toBeTruthy();
    expect(screen.getByTestId("v2-lt-trigger-1")).toBeTruthy();
    expect(screen.getByTestId("v2-lt-hide-1")).toBeTruthy();
  });

  it("uses a slot-suffixed testid on the card so 3 cards can co-exist", () => {
    render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={2}
      />,
    );
    expect(screen.getByTestId("v2-card-08-lower-third-slot-2")).toBeTruthy();
    expect(
      screen.getByTestId("v2-preview-stage-08-lower-third-slot-2"),
    ).toBeTruthy();
  });

  it("re-trigger form carries the correct instanceSlot field for slot 2", () => {
    const { container } = render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={2}
      />,
    );
    const form = container.querySelector(
      '[data-testid="v2-retrigger-form-08-lower-third-2"]',
    ) as HTMLFormElement;
    expect(
      (form.querySelector('input[name="instanceSlot"]') as HTMLInputElement)
        ?.value,
    ).toBe("2");
  });

  it("hide form carries the correct instanceSlot field for slot 3", () => {
    const { container } = render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={3}
      />,
    );
    const hideForm = container.querySelector(
      '[data-testid="v2-hide-form-08-lower-third-3"]',
    ) as HTMLFormElement;
    expect(
      (
        hideForm.querySelector(
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
        slot={1}
      />,
    );
    const form = container.querySelector(
      '[data-testid="v2-retrigger-form-08-lower-third-1"]',
    ) as HTMLFormElement;
    const payloadInput = form.querySelector(
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

  it("typing into the slot updates the payload value", () => {
    const { container } = render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={1}
      />,
    );
    const nameInput = screen.getByTestId("v2-lt-name-1") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "ZARA" } });

    const form = container.querySelector(
      '[data-testid="v2-retrigger-form-08-lower-third-1"]',
    ) as HTMLFormElement;
    const payloadInput = form.querySelector(
      'input[name="payload"]',
    ) as HTMLInputElement;
    const parsed = JSON.parse(payloadInput.value);
    expect(parsed.displayName).toBe("ZARA");
  });

  it("re-trigger refresh — multi-edit reflects latest name+role each time", () => {
    const { container } = render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={1}
      />,
    );
    const nameInput = screen.getByTestId("v2-lt-name-1") as HTMLInputElement;
    const roleInput = screen.getByTestId("v2-lt-role-1") as HTMLInputElement;
    const getPayload = () => {
      const form = container.querySelector(
        '[data-testid="v2-retrigger-form-08-lower-third-1"]',
      ) as HTMLFormElement;
      return JSON.parse(
        (
          form.querySelector('input[name="payload"]') as HTMLInputElement
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
        slot={1}
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

  it("preset load populates the slot's inputs from localStorage", () => {
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
        slot={1}
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

  it("Trigger button text stays 'Trigger' regardless of active state", () => {
    const { rerender } = render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={1}
        active={false}
      />,
    );
    expect(
      (screen.getByTestId("v2-lt-trigger-1") as HTMLButtonElement).textContent
        ?.trim(),
    ).toBe("Trigger");

    rerender(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={1}
        active={true}
      />,
    );
    expect(
      (screen.getByTestId("v2-lt-trigger-1") as HTMLButtonElement).textContent
        ?.trim(),
    ).toBe("Trigger");
  });

  it("Hide button is enabled when active=true, disabled when active=false", () => {
    const { rerender } = render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={2}
        active={false}
      />,
    );
    expect(
      (screen.getByTestId("v2-lt-hide-2") as HTMLButtonElement).disabled,
    ).toBe(true);

    rerender(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={2}
        active={true}
      />,
    );
    expect(
      (screen.getByTestId("v2-lt-hide-2") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("slot-level Live badge surfaces this slot's active state", () => {
    const { rerender } = render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={3}
        active={false}
      />,
    );
    expect(screen.queryByTestId("v2-lt-live-3")).toBeNull();

    rerender(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={3}
        active={true}
      />,
    );
    expect(screen.getByTestId("v2-lt-live-3")).toBeTruthy();
  });

  it("card header label defaults to 'Lower Third {slot}'", () => {
    render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={2}
      />,
    );
    expect(screen.getByText("Lower Third 2")).toBeTruthy();
  });

  it("cardLabel prop overrides the default header", () => {
    render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={1}
        cardLabel="Caster A"
      />,
    );
    expect(screen.getByText("Caster A")).toBeTruthy();
  });

  it("card-level Live badge appears when this slot is active", () => {
    const { rerender } = render(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={2}
        active={false}
      />,
    );
    expect(
      screen.queryByTestId("v2-live-badge-08-lower-third-slot-2"),
    ).toBeNull();

    rerender(
      <LowerThirdControl
        sessionId={SESSION_ID}
        viewToken={VIEW_TOKEN}
        slot={2}
        active={true}
      />,
    );
    expect(
      screen.getByTestId("v2-live-badge-08-lower-third-slot-2"),
    ).toBeTruthy();
  });
});
