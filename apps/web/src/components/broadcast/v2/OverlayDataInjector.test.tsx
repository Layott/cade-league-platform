import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import OverlayDataInjector from "./OverlayDataInjector";

/**
 * Plan 51 — OverlayDataInjector tests.
 *
 * The injector iframes the static HTML mirror + relays Realtime + parent
 * postMessages into the iframe. Tests cover:
 *   - iframe src = `/overlays/v2/<key>/index.html` with optional query params
 *   - parent postMessage relay (forwarded into iframe contentWindow)
 *   - Realtime channel only opened when seasonId provided AND key has events
 *   - Realtime events forwarded as { type:'update', event, payload }
 *   - cleanup tears down channel
 */

// Mock the browser supabase client. Each test owns the mock channel so we
// can capture event handlers + assert subscribe/remove calls.
const mockChannel = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
};
const mockSb = {
  channel: vi.fn(() => mockChannel),
  removeChannel: vi.fn(),
};

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => mockSb,
}));

beforeEach(() => {
  cleanup();
  mockChannel.on.mockClear().mockReturnThis();
  mockChannel.subscribe.mockClear().mockReturnThis();
  mockSb.channel.mockClear().mockReturnValue(mockChannel);
  mockSb.removeChannel.mockClear();
});

function getIframe(container: HTMLElement): HTMLIFrameElement {
  const el = container.querySelector("iframe");
  if (!el) throw new Error("iframe not rendered");
  return el as HTMLIFrameElement;
}

describe("OverlayDataInjector", () => {
  it("renders iframe pointed at the static HTML mirror", () => {
    const { container } = render(
      <OverlayDataInjector overlayKey="01-brb" />,
    );
    const iframe = getIframe(container);
    expect(iframe.getAttribute("src")).toBe(
      "/overlays/v2/01-brb/index.html",
    );
    expect(iframe.title).toMatch(/01-brb/);
  });

  it("appends session + token query params when provided", () => {
    const { container } = render(
      <OverlayDataInjector
        overlayKey="07-leaderboard"
        sessionId="sess-1"
        token="tok-2"
      />,
    );
    const iframe = getIframe(container);
    const src = iframe.getAttribute("src")!;
    expect(src.startsWith("/overlays/v2/07-leaderboard/index.html?")).toBe(
      true,
    );
    expect(src).toContain("session=sess-1");
    expect(src).toContain("token=tok-2");
  });

  it("does NOT open a Realtime channel when seasonId omitted", () => {
    render(<OverlayDataInjector overlayKey="07-leaderboard" />);
    expect(mockSb.channel).not.toHaveBeenCalled();
  });

  it("does NOT open a Realtime channel for keys without realtime events", () => {
    render(
      <OverlayDataInjector overlayKey="01-brb" seasonId="season-x" />,
    );
    expect(mockSb.channel).not.toHaveBeenCalled();
  });

  it("opens a Realtime channel for leaderboard with seasonId", () => {
    render(
      <OverlayDataInjector
        overlayKey="07-leaderboard"
        seasonId="season-x"
      />,
    );
    expect(mockSb.channel).toHaveBeenCalledWith(
      "public:standings:season-x",
      expect.any(Object),
    );
    // leaderboard subscribes to standings.changed + snapshot.captured
    const events = mockChannel.on.mock.calls.map((c) => c[1].event);
    expect(events).toContain("standings.changed");
    expect(events).toContain("snapshot.captured");
    expect(mockChannel.subscribe).toHaveBeenCalledTimes(1);
  });

  it("forwards Realtime payload into iframe via postMessage", () => {
    const { container } = render(
      <OverlayDataInjector
        overlayKey="09-secondary-score-bug"
        seasonId="season-x"
      />,
    );
    const iframe = getIframe(container);
    const postSpy = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage: postSpy },
      configurable: true,
    });

    // Find the score.changed handler that was registered via channel.on
    const call = mockChannel.on.mock.calls.find(
      (c) => c[1].event === "score.changed",
    );
    expect(call).toBeTruthy();
    const handler = call![2];
    const payload = { matchId: "m1", homeScore: 3, awayScore: 1 };
    handler({ payload });

    expect(postSpy).toHaveBeenCalledWith(
      { type: "update", event: "score.changed", payload },
      "*",
    );
  });

  it("relays parent window postMessage into iframe", () => {
    const { container } = render(
      <OverlayDataInjector overlayKey="02-timer" />,
    );
    const iframe = getIframe(container);
    const postSpy = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage: postSpy },
      configurable: true,
    });

    // Dispatch a synthetic message event on the window — should be relayed
    // into the iframe contentWindow.
    const evt = new MessageEvent("message", {
      data: { type: "timer:start", seconds: 600 },
    });
    window.dispatchEvent(evt);

    expect(postSpy).toHaveBeenCalledWith(
      { type: "timer:start", seconds: 600 },
      "*",
    );
  });

  it("does NOT relay messages that originated from the iframe itself", () => {
    const { container } = render(
      <OverlayDataInjector overlayKey="08-lower-third" />,
    );
    const iframe = getIframe(container);
    const fakeContentWindow = { postMessage: vi.fn() };
    Object.defineProperty(iframe, "contentWindow", {
      value: fakeContentWindow,
      configurable: true,
    });

    // Self-originating message (source === iframe.contentWindow) MUST be
    // ignored to prevent infinite ping-pong.
    const evt = new MessageEvent("message", {
      data: { type: "internal:loop" },
      source: fakeContentWindow as unknown as Window,
    });
    window.dispatchEvent(evt);

    expect(fakeContentWindow.postMessage).not.toHaveBeenCalled();
  });

  it("ignores non-object message payloads (extension noise)", () => {
    const { container } = render(
      <OverlayDataInjector overlayKey="08-lower-third" />,
    );
    const iframe = getIframe(container);
    const postSpy = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage: postSpy },
      configurable: true,
    });

    window.dispatchEvent(
      new MessageEvent("message", { data: "string-noise" }),
    );
    window.dispatchEvent(new MessageEvent("message", { data: 42 }));
    window.dispatchEvent(new MessageEvent("message", { data: null }));

    expect(postSpy).not.toHaveBeenCalled();
  });

  it("removes the channel on unmount", () => {
    const { unmount } = render(
      <OverlayDataInjector overlayKey="07-leaderboard" seasonId="s-x" />,
    );
    expect(mockSb.removeChannel).not.toHaveBeenCalled();
    unmount();
    expect(mockSb.removeChannel).toHaveBeenCalledWith(mockChannel);
  });

  it("subscribes match-scores-day to all three relevant events", () => {
    render(
      <OverlayDataInjector
        overlayKey="11-match-scores-day"
        seasonId="s-x"
      />,
    );
    const events = mockChannel.on.mock.calls.map((c) => c[1].event);
    expect(events).toEqual(
      expect.arrayContaining([
        "score.changed",
        "match.ended",
        "standings.changed",
      ]),
    );
  });

  async function flush() {
    // React state updates from a non-batched event (DOM dispatchEvent) need
    // a tick to flush + a second to drain the fetch promise resolution.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  it("does NOT call fetch when sessionId is missing", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}"),
    );
    render(<OverlayDataInjector overlayKey="07-leaderboard" />);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("calls initial-fetch endpoint after iframe loads (leaderboard)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ payload: { rows: [] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const { container } = render(
      <OverlayDataInjector
        overlayKey="07-leaderboard"
        sessionId="sess-1"
      />,
    );
    const iframe = getIframe(container);
    await act(async () => {
      iframe.dispatchEvent(new Event("load"));
      await flush();
    });
    expect(fetchSpy).toHaveBeenCalled();
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain("/api/broadcast/sessions/sess-1/leaderboard");
    fetchSpy.mockRestore();
  });

  it("includes token in initial-fetch URL when supplied", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const { container } = render(
      <OverlayDataInjector
        overlayKey="14-top-scorers"
        sessionId="sess-2"
        token="tok-9"
      />,
    );
    const iframe = getIframe(container);
    await act(async () => {
      iframe.dispatchEvent(new Event("load"));
      await flush();
    });
    const url = fetchSpy.mock.calls[0]?.[0] as string | undefined;
    expect(url).toBeTruthy();
    expect(url).toContain("/api/broadcast/sessions/sess-2/top-scorers");
    expect(url).toContain("token=tok-9");
    fetchSpy.mockRestore();
  });

  it("uses /api/broadcast/v2 path for orgs/coaches/penalties", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const { container } = render(
      <OverlayDataInjector overlayKey="15-orgs" sessionId="s-3" />,
    );
    const iframe = getIframe(container);
    await act(async () => {
      iframe.dispatchEvent(new Event("load"));
      await flush();
    });
    const url = fetchSpy.mock.calls[0]?.[0] as string | undefined;
    expect(url).toContain("/api/broadcast/v2/sessions/s-3/orgs");
    fetchSpy.mockRestore();
  });

  it("does NOT call fetch for keys without an initial-fetch endpoint", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));
    const { container } = render(
      <OverlayDataInjector overlayKey="01-brb" sessionId="s-x" />,
    );
    const iframe = getIframe(container);
    await act(async () => {
      iframe.dispatchEvent(new Event("load"));
      await flush();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
