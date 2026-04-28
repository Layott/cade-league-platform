import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CasesSegmentedTabs } from "./CasesSegmentedTabs";

/**
 * UI Audit Slice 2 — segmented tabs unit coverage. Renders both
 * states (disputes active / appeals active) and asserts:
 *  - aria-selected on the right tab
 *  - count badges show the supplied numbers
 *  - hrefs use ?tab=disputes / ?tab=appeals (so the parent server
 *    component re-fetches with the right segment)
 */

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => cleanup());

describe("CasesSegmentedTabs", () => {
  it("marks the disputes tab as active when active='disputes'", () => {
    render(
      <CasesSegmentedTabs active="disputes" disputesCount={2} appealsCount={0} />,
    );
    const disputes = screen.getByTestId("cases-segment-disputes");
    const appeals = screen.getByTestId("cases-segment-appeals");
    expect(disputes.getAttribute("aria-selected")).toBe("true");
    expect(disputes.getAttribute("aria-current")).toBe("page");
    expect(appeals.getAttribute("aria-selected")).toBe("false");
    expect(appeals.getAttribute("aria-current")).toBeNull();
  });

  it("marks the appeals tab as active when active='appeals'", () => {
    render(
      <CasesSegmentedTabs active="appeals" disputesCount={0} appealsCount={3} />,
    );
    const disputes = screen.getByTestId("cases-segment-disputes");
    const appeals = screen.getByTestId("cases-segment-appeals");
    expect(disputes.getAttribute("aria-selected")).toBe("false");
    expect(appeals.getAttribute("aria-selected")).toBe("true");
  });

  it("renders count pills with the supplied numbers", () => {
    render(
      <CasesSegmentedTabs active="disputes" disputesCount={4} appealsCount={1} />,
    );
    expect(
      screen.getByTestId("cases-segment-disputes-count").textContent,
    ).toBe("4");
    expect(
      screen.getByTestId("cases-segment-appeals-count").textContent,
    ).toBe("1");
  });

  it("uses ?tab=… in both hrefs so the parent server page re-renders", () => {
    render(
      <CasesSegmentedTabs active="disputes" disputesCount={0} appealsCount={0} />,
    );
    expect(
      screen
        .getByTestId("cases-segment-disputes")
        .getAttribute("href"),
    ).toBe("/player/cases?tab=disputes");
    expect(
      screen
        .getByTestId("cases-segment-appeals")
        .getAttribute("href"),
    ).toBe("/player/cases?tab=appeals");
  });
});
