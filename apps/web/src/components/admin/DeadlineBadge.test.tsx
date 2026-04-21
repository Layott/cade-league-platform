import { describe, it, expect } from "vitest";
import { formatCountdown, computeDeadlineTone } from "./DeadlineBadge.helpers";

describe("DeadlineBadge helpers (Plan 13B)", () => {
  it("tone = expired when now >= deadline", () => {
    const now = new Date("2026-05-09T00:00:00Z").getTime();
    const deadline = new Date("2026-05-08T23:59:00Z").getTime();
    const { tone } = computeDeadlineTone(deadline, now);
    expect(tone).toBe("expired");
  });

  it("tone = expired when status === 'expired' even if time remains", () => {
    const now = Date.now();
    const deadline = now + 5 * 24 * 60 * 60 * 1000;
    const { tone } = computeDeadlineTone(deadline, now, "expired");
    expect(tone).toBe("expired");
  });

  it("tone = lt24 when remaining < 24h", () => {
    const now = Date.now();
    const deadline = now + 10 * 60 * 60 * 1000; // 10h
    const { tone } = computeDeadlineTone(deadline, now);
    expect(tone).toBe("lt24");
  });

  it("tone = lt72 when 24h ≤ remaining < 72h", () => {
    const now = Date.now();
    const deadline = now + 48 * 60 * 60 * 1000; // 48h
    const { tone } = computeDeadlineTone(deadline, now);
    expect(tone).toBe("lt72");
  });

  it("tone = ok when remaining >= 72h", () => {
    const now = Date.now();
    const deadline = now + 5 * 24 * 60 * 60 * 1000; // 5d
    const { tone } = computeDeadlineTone(deadline, now);
    expect(tone).toBe("ok");
  });

  it("formatCountdown formats as NdHh / Hh", () => {
    const H = 3600 * 1000;
    expect(formatCountdown(0)).toBe("0h");
    expect(formatCountdown(5 * H)).toBe("5h");
    expect(formatCountdown(26 * H)).toBe("1d2h");
    expect(formatCountdown(72 * H)).toBe("3d0h");
  });
});
