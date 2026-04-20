import { describe, it, expect } from "vitest";
import { deviceFingerprint } from "./device";

describe("deviceFingerprint", () => {
  it("stable for same UA + IP prefix + lang", () => {
    const a = deviceFingerprint({
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/124",
      ip: "102.89.4.17",
      acceptLanguage: "en-US,en;q=0.9",
    });
    const b = deviceFingerprint({
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/124",
      ip: "102.89.4.219",
      acceptLanguage: "en-US,en;q=0.9",
    });
    expect(a).toBe(b);
  });

  it("differs on UA change", () => {
    const a = deviceFingerprint({
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/124",
      ip: "102.89.4.17",
      acceptLanguage: "en-US",
    });
    const b = deviceFingerprint({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1",
      ip: "102.89.4.17",
      acceptLanguage: "en-US",
    });
    expect(a).not.toBe(b);
  });

  it("returns 64-char hex", () => {
    const fp = deviceFingerprint({
      userAgent: "x",
      ip: "1.2.3.4",
      acceptLanguage: "en",
    });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});
