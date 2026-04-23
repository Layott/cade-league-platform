import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * Plan 45 — RTL smoke tests for the structured broadcast-panel forms.
 *
 * Each form reads the payload / slot / match bindings from local state and
 * emits a hidden `<input name="payload">` containing the serialised JSON
 * the server action will consume. These tests assert:
 *   1. The expected labelled inputs render.
 *   2. The hidden payload input serialises the user's input into the right
 *      shape (validated against the template's Zod schema when available).
 */

// Stub the server-action imports: tests don't need real server actions, just
// inspectable `action` props on each form. React treats any function as a
// valid form action so the vi.fn stubs are enough.
vi.mock("../../actions", () => ({
  setClockAction: vi.fn(),
  resetClockAction: vi.fn(),
  triggerOverlayAction: vi.fn(),
  scoreBugDeltaAction: vi.fn(),
  resetScoreBugAction: vi.fn(),
  clearScoreBugAction: vi.fn(),
  // Plan 48 — OffTriggerButton mounted inside the structured forms also
  // imports these clear-* actions; stubbed here so JSDOM render doesn't
  // blow up resolving the module.
  clearOverlayAction: vi.fn(),
  clearInstanceAction: vi.fn(),
}));

import { StructuredMatchClockForm } from "./StructuredMatchClockForm";
import { StructuredScoreBugForm } from "./StructuredScoreBugForm";
import { StructuredUpNextForm } from "./StructuredUpNextForm";
import { StructuredStartingSoonForm } from "./StructuredStartingSoonForm";
import { StructuredBrbForm } from "./StructuredBrbForm";
import { StructuredFeaturedCommentForm } from "./StructuredFeaturedCommentForm";
import { upNextBugSchema, startingSoonTimerSchema, layoutBrbFullSchema, featuredCommentSchema, scoreBugSchema } from "@/server/overlays/schemas";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function getHiddenPayload(testId: string): Record<string, unknown> {
  const trigger = screen.getByTestId(testId);
  const form = trigger.closest("form")!;
  const input = form.querySelector<HTMLInputElement>("input[name='payload']");
  expect(input).toBeTruthy();
  return JSON.parse(input!.value);
}

describe("StructuredMatchClockForm", () => {
  it("renders mins + secs + label inputs", () => {
    render(
      <StructuredMatchClockForm
        sessionId={SESSION_ID}
        isLive={true}
        clock={null}
      />,
    );
    expect(screen.getByTestId("clock-minutes")).toBeTruthy();
    expect(screen.getByTestId("clock-seconds")).toBeTruthy();
    expect(screen.getByTestId("clock-label")).toBeTruthy();
  });

  it("composes secondsRemaining from minutes + seconds", () => {
    render(
      <StructuredMatchClockForm
        sessionId={SESSION_ID}
        isLive={true}
        clock={null}
      />,
    );
    fireEvent.change(screen.getByTestId("clock-minutes"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByTestId("clock-seconds"), {
      target: { value: "30" },
    });
    const hidden = screen.getByTestId("clock-total-seconds") as HTMLInputElement;
    expect(hidden.value).toBe("330");
  });

  it("shows the current clock snapshot when present", () => {
    render(
      <StructuredMatchClockForm
        sessionId={SESSION_ID}
        isLive={true}
        clock={{
          streamSessionId: SESSION_ID,
          mode: "countdown",
          secondsRemaining: 125,
          setAt: "2026-04-22T00:00:00Z",
          setBy: null,
          label: "WARMUP",
          updatedAt: "2026-04-22T00:00:00Z",
        }}
      />,
    );
    expect(screen.getByTestId("clock-current").textContent).toContain("02:05");
  });
});

describe("StructuredScoreBugForm", () => {
  const selectable = [
    {
      id: "m1",
      matchDayId: "md-1",
      matchDate: "2026-04-22",
      scheduledTime: "18:00:00",
      status: "scheduled" as const,
      isToday: true,
      home: {
        id: "p-h",
        gamerTag: "ADEFOLA",
        displayName: "Adefola",
        jerseyNumber: 10,
      },
      away: {
        id: "p-a",
        gamerTag: "FARUK",
        displayName: "Faruk",
        jerseyNumber: 7,
      },
    },
  ];

  it("includes slot radios + trigger + reset + OFF buttons", () => {
    render(
      <StructuredScoreBugForm
        sessionId={SESSION_ID}
        isLive={true}
        selectable={selectable}
        activeSingle={null}
      />,
    );
    expect(screen.getByTestId("score-bug-slot")).toBeTruthy();
    expect(screen.getByTestId("score-bug-trigger")).toBeTruthy();
    expect(screen.getByTestId("score-bug-reset")).toBeTruthy();
    expect(screen.getByTestId("score-bug-off")).toBeTruthy();
  });

  it("payload has players array + default slot=primary", () => {
    render(
      <StructuredScoreBugForm
        sessionId={SESSION_ID}
        isLive={true}
        selectable={selectable}
        activeSingle={null}
      />,
    );
    fireEvent.change(screen.getByTestId("score-bug-home-name"), {
      target: { value: "Home Player" },
    });
    fireEvent.change(screen.getByTestId("score-bug-away-name"), {
      target: { value: "Away Player" },
    });
    fireEvent.change(screen.getByTestId("score-bug-home-input"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByTestId("score-bug-away-input"), {
      target: { value: "1" },
    });
    const payload = getHiddenPayload("score-bug-trigger") as {
      players: Array<{ score: number; displayName: string }>;
      slot: string;
    };
    expect(payload.slot).toBe("primary");
    expect(payload.players).toHaveLength(2);
    expect(payload.players[0].score).toBe(3);
    expect(payload.players[1].score).toBe(1);
    // Payload should Zod-validate (after filling valid names).
    const res = scoreBugSchema.safeParse(payload);
    expect(res.success).toBe(true);
  });

  it("autofills names when a match is selected + locks the name inputs", () => {
    render(
      <StructuredScoreBugForm
        sessionId={SESSION_ID}
        isLive={true}
        selectable={selectable}
        activeSingle={null}
      />,
    );
    fireEvent.change(screen.getByTestId("score-bug-match-select"), {
      target: { value: "m1" },
    });
    const home = screen.getByTestId("score-bug-home-name") as HTMLInputElement;
    expect(home.value).toBe("Adefola");
    expect(home.readOnly).toBe(true);
  });
});

describe("StructuredUpNextForm", () => {
  const unplayed = [
    {
      id: "m1",
      matchDayId: "md-1",
      matchDate: "2026-04-22",
      scheduledTime: "19:30:00",
      kickoffAt: "2026-04-22T19:30:00.000Z",
      home: { id: "h", displayName: "Adefola", gamerTag: "ADEFOLA" },
      away: { id: "a", displayName: "Faruk", gamerTag: "FARUK" },
      status: "scheduled" as const,
    },
  ];

  it("shows empty-state message when no un-played matches", () => {
    render(
      <StructuredUpNextForm
        sessionId={SESSION_ID}
        isLive={true}
        unplayed={[]}
      />,
    );
    expect(screen.getByTestId("up-next-empty")).toBeTruthy();
  });

  it("selecting a match auto-fills the three fields + emits schema-valid payload", () => {
    render(
      <StructuredUpNextForm
        sessionId={SESSION_ID}
        isLive={true}
        unplayed={unplayed}
      />,
    );
    fireEvent.change(screen.getByTestId("up-next-match-select"), {
      target: { value: "m1" },
    });
    const homeInput = screen.getByTestId("up-next-home") as HTMLInputElement;
    expect(homeInput.value).toBe("Adefola");
    const payload = getHiddenPayload("up-next-trigger");
    const res = upNextBugSchema.safeParse(payload);
    expect(res.success).toBe(true);
  });
});

describe("StructuredStartingSoonForm", () => {
  it("emits a schema-valid payload with startsAt ISO", () => {
    render(
      <StructuredStartingSoonForm sessionId={SESSION_ID} isLive={true} />,
    );
    const payload = getHiddenPayload("starting-soon-trigger") as {
      startsAt: string;
    };
    expect(payload.startsAt).toMatch(/^\d{4}-/);
    const res = startingSoonTimerSchema.safeParse(payload);
    expect(res.success).toBe(true);
  });
});

describe("StructuredBrbForm", () => {
  it("emits a schema-valid payload with resumeAt ISO", () => {
    render(<StructuredBrbForm sessionId={SESSION_ID} isLive={true} />);
    const payload = getHiddenPayload("brb-trigger") as {
      resumeAt: string;
    };
    expect(payload.resumeAt).toMatch(/^\d{4}-/);
    const res = layoutBrbFullSchema.safeParse(payload);
    expect(res.success).toBe(true);
  });
});

describe("StructuredFeaturedCommentForm", () => {
  it("emits a schema-valid payload when author + message present", () => {
    render(
      <StructuredFeaturedCommentForm sessionId={SESSION_ID} isLive={true} />,
    );
    fireEvent.change(screen.getByTestId("fc-author"), {
      target: { value: "Kunle" },
    });
    fireEvent.change(screen.getByTestId("fc-message"), {
      target: { value: "GG WP" },
    });
    const payload = getHiddenPayload("fc-trigger");
    const res = featuredCommentSchema.safeParse(payload);
    expect(res.success).toBe(true);
  });

  it("includes cssOverrides field when typed", () => {
    render(
      <StructuredFeaturedCommentForm sessionId={SESSION_ID} isLive={true} />,
    );
    fireEvent.change(screen.getByTestId("fc-message"), {
      target: { value: "GG" },
    });
    fireEvent.change(screen.getByTestId("fc-css"), {
      target: { value: ".fc-card { background: red; }" },
    });
    const payload = getHiddenPayload("fc-trigger") as {
      cssOverrides?: string;
    };
    expect(payload.cssOverrides).toBe(".fc-card { background: red; }");
  });
});
