import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomDesignsTab } from "./CustomDesignsTab";

const DESIGNS = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "lower-third-blue",
    title: "Lower Third — Blue",
    thumbnailUrl: null,
    overlayKey: "user-lower-third-blue" as const,
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    slug: "winner-stinger-v2",
    title: "Winner Stinger v2",
    thumbnailUrl: "https://example.test/thumb.png",
    overlayKey: "user-winner-stinger-v2" as const,
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    slug: "intro-card",
    title: "Intro Card",
    thumbnailUrl: null,
    overlayKey: "user-intro-card" as const,
  },
];

describe("CustomDesignsTab", () => {
  it("renders a card per published design", () => {
    render(
      <CustomDesignsTab
        designs={DESIGNS}
        sessionId="sess-1"
        viewToken="tok"
        canTrigger={true}
        triggerAction={vi.fn()}
        clearAction={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId(/^custom-design-card-/)).toHaveLength(3);
    expect(screen.getByText("Lower Third — Blue")).toBeInTheDocument();
    expect(screen.getByText("Winner Stinger v2")).toBeInTheDocument();
    expect(screen.getByText("Intro Card")).toBeInTheDocument();
  });

  it("renders an empty-state when no designs are published", () => {
    render(
      <CustomDesignsTab
        designs={[]}
        sessionId="sess-1"
        viewToken="tok"
        canTrigger={true}
        triggerAction={vi.fn()}
        clearAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("custom-designs-empty")).toBeInTheDocument();
    expect(screen.queryByTestId(/^custom-design-card-/)).toBeNull();
  });

  it("preview iframe src uses /overlay/v2/user/<slug> with session + token + preview=1", () => {
    render(
      <CustomDesignsTab
        designs={DESIGNS}
        sessionId="sess-42"
        viewToken="view-token-abc"
        canTrigger={true}
        triggerAction={vi.fn()}
        clearAction={vi.fn()}
      />,
    );
    const card = screen.getByTestId("custom-design-card-lower-third-blue");
    const iframe = within(card).getByTestId(
      "custom-preview-iframe-lower-third-blue",
    ) as HTMLIFrameElement;
    expect(iframe.src).toContain("/overlay/v2/user/lower-third-blue");
    expect(iframe.src).toContain("sessionId=sess-42");
    expect(iframe.src).toContain("token=view-token-abc");
    expect(iframe.src).toContain("preview=1");
    expect(iframe.src).not.toContain("demo=1");
  });

  it("clicking Trigger calls the triggerAction with overlayKey + sessionId", async () => {
    const user = userEvent.setup();
    const triggerAction = vi.fn().mockResolvedValue({ ok: true });
    render(
      <CustomDesignsTab
        designs={DESIGNS}
        sessionId="sess-1"
        viewToken="tok"
        canTrigger={true}
        triggerAction={triggerAction}
        clearAction={vi.fn()}
      />,
    );
    const card = screen.getByTestId("custom-design-card-lower-third-blue");
    await user.click(within(card).getByTestId("custom-trigger-lower-third-blue"));
    expect(triggerAction).toHaveBeenCalledWith({
      overlayKey: "user-lower-third-blue",
      sessionId: "sess-1",
    });
  });

  it("clicking Hide calls the clearAction with overlayKey + sessionId", async () => {
    const user = userEvent.setup();
    const clearAction = vi.fn().mockResolvedValue({ ok: true });
    render(
      <CustomDesignsTab
        designs={DESIGNS}
        sessionId="sess-1"
        viewToken="tok"
        canTrigger={true}
        triggerAction={vi.fn()}
        clearAction={clearAction}
      />,
    );
    const card = screen.getByTestId("custom-design-card-lower-third-blue");
    await user.click(within(card).getByTestId("custom-hide-lower-third-blue"));
    expect(clearAction).toHaveBeenCalledWith({
      overlayKey: "user-lower-third-blue",
      sessionId: "sess-1",
    });
  });

  it("disables Trigger + Hide when canTrigger is false", () => {
    render(
      <CustomDesignsTab
        designs={DESIGNS}
        sessionId="sess-1"
        viewToken="tok"
        canTrigger={false}
        triggerAction={vi.fn()}
        clearAction={vi.fn()}
      />,
    );
    const card = screen.getByTestId("custom-design-card-lower-third-blue");
    expect(within(card).getByTestId("custom-trigger-lower-third-blue")).toBeDisabled();
    expect(within(card).getByTestId("custom-hide-lower-third-blue")).toBeDisabled();
  });

  it("renders disabled state when enabled prop is false", () => {
    render(
      <CustomDesignsTab
        designs={DESIGNS}
        sessionId="sess-1"
        viewToken="tok"
        canTrigger={true}
        triggerAction={vi.fn()}
        clearAction={vi.fn()}
        enabled={false}
      />,
    );
    expect(screen.getByTestId("custom-designs-disabled")).toBeInTheDocument();
    expect(screen.queryByTestId(/^custom-design-card-/)).toBeNull();
  });
});
