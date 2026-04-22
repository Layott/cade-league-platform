import { describe, it, expect, vi, beforeEach } from "vitest";

const { publishMock } = vi.hoisted(() => ({
  publishMock: vi.fn().mockResolvedValue("ok"),
}));
vi.mock("@/server/broadcast/realtime", () => ({ publish: publishMock }));

import {
  setClock,
  getClock,
  pauseClock,
  resumeClock,
  adjustClock,
  resetClock,
} from "./match_clock";

function clockTable(opts: { row?: Record<string, unknown> | null }) {
  const upsertSingle = vi.fn().mockImplementation(async () => {
    // Echo back what was upserted in row form so toState() works.
    return { data: opts.row ?? null, error: null };
  });
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.row ?? null, error: null });

  return {
    upsert: vi.fn(() => ({ select: vi.fn(() => ({ single: upsertSingle })) })),
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({ maybeSingle })),
      })),
    })),
    _spies: { upsertSingle, maybeSingle },
    _setRow(r: Record<string, unknown>) {
      opts.row = r;
      maybeSingle.mockResolvedValue({ data: r, error: null });
      upsertSingle.mockResolvedValue({ data: r, error: null });
    },
  };
}

function mkSb(table: ReturnType<typeof clockTable>) {
  return { from: vi.fn(() => table) };
}

const ECHO_BASE = {
  stream_session_id: "s",
  mode: "stopped",
  seconds_remaining: 0,
  set_at: "2026-04-22T00:00:00Z",
  set_by: "u",
  label: null,
  updated_at: "2026-04-22T00:00:00Z",
};

describe("setClock", () => {
  beforeEach(() => publishMock.mockClear());

  it("upserts mode/seconds/set_at atomically and publishes clock.changed", async () => {
    const t = clockTable({
      row: { ...ECHO_BASE, mode: "countdown", seconds_remaining: 300 },
    });
    const out = await setClock(mkSb(t) as never, "s", {
      mode: "countdown",
      secondsRemaining: 300,
      label: "WARMUP",
      userId: "u",
    });
    expect(out.mode).toBe("countdown");
    expect(out.secondsRemaining).toBe(300);
    expect(t.upsert).toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      "s",
      "clock.changed",
      expect.objectContaining({ mode: "countdown", secondsRemaining: 300 }),
    );
  });

  it("clamps secondsRemaining to 0..359999", async () => {
    const t = clockTable({ row: ECHO_BASE });
    await setClock(mkSb(t) as never, "s", {
      mode: "countdown",
      secondsRemaining: 999_999,
      userId: "u",
    });
    const arg = (t.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      seconds_remaining: number;
    };
    expect(arg.seconds_remaining).toBe(359999);
  });
});

describe("getClock", () => {
  it("returns null when no row exists for the session", async () => {
    const t = clockTable({ row: null });
    const out = await getClock(mkSb(t) as never, "s");
    expect(out).toBeNull();
  });
});

describe("pauseClock", () => {
  beforeEach(() => publishMock.mockClear());

  it("computes display from prior running state and writes paused", async () => {
    // Set "set_at" to 10 seconds ago, mode countdown 300 → display ~290
    const tenSecAgo = new Date(Date.now() - 10_000).toISOString();
    const t = clockTable({
      row: {
        ...ECHO_BASE,
        mode: "countdown",
        seconds_remaining: 300,
        set_at: tenSecAgo,
      },
    });
    // After upsert echoes back paused row
    await pauseClock(mkSb(t) as never, "s", "u");
    const arg = (t.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      mode: string;
      seconds_remaining: number;
    };
    expect(arg.mode).toBe("paused");
    expect(arg.seconds_remaining).toBeGreaterThanOrEqual(289);
    expect(arg.seconds_remaining).toBeLessThanOrEqual(291);
  });

  it("throws when there's no clock row to pause", async () => {
    const t = clockTable({ row: null });
    await expect(pauseClock(mkSb(t) as never, "s", "u")).rejects.toThrow(
      /no clock/,
    );
  });
});

describe("resumeClock", () => {
  it("preserves seconds_remaining and resets set_at, picking countdown when remaining > 0", async () => {
    const t = clockTable({
      row: { ...ECHO_BASE, mode: "paused", seconds_remaining: 222 },
    });
    await resumeClock(mkSb(t) as never, "s", "u");
    const arg = (t.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      mode: string;
      seconds_remaining: number;
    };
    expect(arg.mode).toBe("countdown");
    expect(arg.seconds_remaining).toBe(222);
  });
});

describe("adjustClock", () => {
  it("clamps display+delta to >= 0", async () => {
    const t = clockTable({
      row: { ...ECHO_BASE, mode: "paused", seconds_remaining: 10 },
    });
    await adjustClock(mkSb(t) as never, "s", -60, "u");
    const arg = (t.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      seconds_remaining: number;
    };
    expect(arg.seconds_remaining).toBe(0);
  });
});

describe("resetClock", () => {
  it("writes mode=stopped + seconds=0", async () => {
    const t = clockTable({ row: ECHO_BASE });
    await resetClock(mkSb(t) as never, "s", "u");
    const arg = (t.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      mode: string;
      seconds_remaining: number;
    };
    expect(arg.mode).toBe("stopped");
    expect(arg.seconds_remaining).toBe(0);
  });
});
