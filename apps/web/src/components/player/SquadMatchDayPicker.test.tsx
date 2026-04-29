import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import {
  SquadMatchDayPicker,
  type SquadMatchDayPickerItem,
} from "./SquadMatchDayPicker";

// next/link in a Vitest jsdom env — mock to a plain anchor.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  cleanup();
});

const mk = (
  partial: Partial<SquadMatchDayPickerItem> &
    Pick<SquadMatchDayPickerItem, "matchDayId" | "matchDate" | "status">,
): SquadMatchDayPickerItem => ({
  venueName: "Lagos Arena",
  bucket: "this_week",
  ...partial,
});

describe("SquadMatchDayPicker", () => {
  it("renders an empty-state when no match days are scheduled", () => {
    render(<SquadMatchDayPicker items={[]} />);
    expect(screen.getByTestId("squad-match-day-picker-empty")).toBeTruthy();
  });

  it("renders bucketed sections (this week / upcoming / past)", () => {
    render(
      <SquadMatchDayPicker
        items={[
          mk({
            matchDayId: "tw-1",
            matchDate: "2026-04-29",
            status: "open",
            bucket: "this_week",
          }),
          mk({
            matchDayId: "up-1",
            matchDate: "2026-05-06",
            status: "upcoming",
            bucket: "upcoming",
          }),
          mk({
            matchDayId: "pa-1",
            matchDate: "2026-04-22",
            status: "submitted",
            submittedAt: "2026-04-21T11:00:00Z",
            validationStatus: "approved",
            bucket: "past",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("squad-md-bucket-this-week")).toBeTruthy();
    expect(screen.getByTestId("squad-md-bucket-upcoming")).toBeTruthy();
    expect(screen.getByTestId("squad-md-bucket-past")).toBeTruthy();
  });

  it("renders a Submit CTA + 'Submission open' pill for status=open", () => {
    render(
      <SquadMatchDayPicker
        items={[
          mk({
            matchDayId: "open-1",
            matchDate: "2026-04-29",
            status: "open",
            bucket: "this_week",
          }),
        ]}
      />,
    );
    const cta = screen.getByTestId("md-cta-submit-open-1") as HTMLAnchorElement;
    expect(cta).toBeTruthy();
    expect(cta.getAttribute("href")).toContain("matchDay=open-1");
    expect(screen.getByText(/submission open/i)).toBeTruthy();
  });

  it("renders a View CTA + Approved pill for status=submitted+approved", () => {
    render(
      <SquadMatchDayPicker
        items={[
          mk({
            matchDayId: "sub-1",
            matchDate: "2026-04-22",
            status: "submitted",
            validationStatus: "approved",
            submittedAt: "2026-04-21T08:00:00Z",
            bucket: "past",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("md-cta-view-sub-1")).toBeTruthy();
    expect(screen.getByText(/approved/i)).toBeTruthy();
  });

  it("renders a Closed CTA for status=closed", () => {
    render(
      <SquadMatchDayPicker
        items={[
          mk({
            matchDayId: "cl-1",
            matchDate: "2026-04-22",
            status: "closed",
            bucket: "past",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("md-cta-closed-cl-1")).toBeTruthy();
    expect(screen.getAllByText(/window closed|closed/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders a Coming-up CTA for status=upcoming", () => {
    render(
      <SquadMatchDayPicker
        items={[
          mk({
            matchDayId: "up-1",
            matchDate: "2026-05-06",
            status: "upcoming",
            bucket: "upcoming",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("md-cta-upcoming-up-1")).toBeTruthy();
    // "Coming up" appears as both the pill label + CTA text — getAllByText.
    expect(screen.getAllByText(/coming up/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders a Rejected pill when validationStatus=rejected", () => {
    render(
      <SquadMatchDayPicker
        items={[
          mk({
            matchDayId: "rej-1",
            matchDate: "2026-04-22",
            status: "submitted",
            validationStatus: "rejected",
            submittedAt: "2026-04-21T08:00:00Z",
            bucket: "past",
          }),
        ]}
      />,
    );
    expect(screen.getByText(/rejected/i)).toBeTruthy();
    expect(screen.getByTestId("md-cta-view-rej-1")).toBeTruthy();
  });
});
