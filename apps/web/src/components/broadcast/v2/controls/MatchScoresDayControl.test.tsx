import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("@/app/admin/broadcast/v2/[sessionId]/actions", () => ({
  triggerOverlayEnterAction: vi.fn(async () => undefined),
  triggerOverlayOffAction: vi.fn(async () => undefined),
}));

import { MatchScoresDayControl } from "./MatchScoresDayControl";

beforeEach(() => {
  cleanup();
});

describe("MatchScoresDayControl", () => {
  it("renders 4 part buttons (1, 2, 3, all)", () => {
    render(<MatchScoresDayControl sessionId="S" viewToken="T" />);
    expect(screen.getByTestId("v2-msd-part-1")).toBeTruthy();
    expect(screen.getByTestId("v2-msd-part-2")).toBeTruthy();
    expect(screen.getByTestId("v2-msd-part-3")).toBeTruthy();
    expect(screen.getByTestId("v2-msd-part-all")).toBeTruthy();
  });

  it("each part button form includes the matching partRange in the payload", () => {
    const { container } = render(
      <MatchScoresDayControl sessionId="S" viewToken="T" />,
    );
    for (const id of [1, 2, 3, "all"] as const) {
      const form = container.querySelector(
        `[data-testid="v2-msd-part-form-${id}"]`,
      ) as HTMLFormElement;
      expect(form).toBeTruthy();
      const payload = (
        form.querySelector('input[name="payload"]') as HTMLInputElement
      ).value;
      const parsed = JSON.parse(payload);
      expect(parsed.partRange).toBe(id);
      // matchDayLabel must satisfy the legacy Zod min(1) requirement.
      expect(parsed.matchDayLabel.length).toBeGreaterThan(0);
    }
  });
});
