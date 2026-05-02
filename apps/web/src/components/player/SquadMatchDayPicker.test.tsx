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

  it("renders an Edit CTA when submission is pending + window is still open", () => {
    render(
      <SquadMatchDayPicker
        items={[
          mk({
            matchDayId: "edit-1",
            matchDate: "2026-04-29",
            status: "submitted",
            validationStatus: "pending",
            submittedAt: "2026-04-28T08:00:00Z",
            windowOpen: true,
            bucket: "this_week",
          }),
        ]}
      />,
    );
    const cta = screen.getByTestId("md-cta-edit-edit-1") as HTMLAnchorElement;
    expect(cta).toBeTruthy();
    expect(cta.getAttribute("href")).toContain("matchDay=edit-1");
    expect(cta.getAttribute("href")).toContain("edit=1");
    expect(cta.textContent?.toLowerCase()).toContain("edit");
  });

  it("falls back to View CTA when submission is pending but window has closed", () => {
    render(
      <SquadMatchDayPicker
        items={[
          mk({
            matchDayId: "view-after-close",
            matchDate: "2026-04-22",
            status: "submitted",
            validationStatus: "pending",
            submittedAt: "2026-04-21T08:00:00Z",
            windowOpen: false,
            bucket: "past",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("md-cta-view-view-after-close")).toBeTruthy();
    expect(screen.queryByTestId("md-cta-edit-view-after-close")).toBeNull();
  });

  it("falls back to View CTA when window is open but submission is approved", () => {
    render(
      <SquadMatchDayPicker
        items={[
          mk({
            matchDayId: "view-after-approve",
            matchDate: "2026-04-29",
            status: "submitted",
            validationStatus: "approved",
            submittedAt: "2026-04-28T08:00:00Z",
            windowOpen: true,
            bucket: "this_week",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("md-cta-view-view-after-approve")).toBeTruthy();
    expect(screen.queryByTestId("md-cta-edit-view-after-approve")).toBeNull();
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

  it("renders an Edit CTA on a REJECTED submission when window is force-open (2026-05-02)", () => {
    // Per the user-reported bug "edit-always-when-window-open": admin
    // force-open is the explicit signal that the player should be able
    // to revise a rejected squad without first asking for a manual
    // reopen.
    render(
      <SquadMatchDayPicker
        items={[
          mk({
            matchDayId: "force-rej-1",
            matchDate: "2026-04-29",
            status: "submitted",
            validationStatus: "rejected",
            submittedAt: "2026-04-28T08:00:00Z",
            windowOpen: true,
            forceOpen: true,
            bucket: "this_week",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("md-cta-edit-force-rej-1")).toBeTruthy();
    expect(screen.queryByTestId("md-cta-view-force-rej-1")).toBeNull();
  });

  it("renders an Edit CTA on an APPROVED submission when window is force-open (2026-05-02)", () => {
    render(
      <SquadMatchDayPicker
        items={[
          mk({
            matchDayId: "force-app-1",
            matchDate: "2026-04-29",
            status: "submitted",
            validationStatus: "approved",
            submittedAt: "2026-04-28T08:00:00Z",
            windowOpen: true,
            forceOpen: true,
            bucket: "this_week",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("md-cta-edit-force-app-1")).toBeTruthy();
    expect(screen.queryByTestId("md-cta-view-force-app-1")).toBeNull();
  });

  it("renders Sat + Sun as TWO separate rows when both are open and have no submission (no displayLabel)", () => {
    // 2026-05-02 (user-reported, item 1) — when both Saturday and Sunday
    // match days in the same weekend are open AND neither has a
    // submission yet, the page-level grouper skips the collapse so the
    // player can pick which specific match day they want to file for.
    // This component test exercises the rendered shape: each row carries
    // its raw matchDate (no displayLabel) and its own Submit CTA.
    render(
      <SquadMatchDayPicker
        items={[
          mk({
            matchDayId: "sat-md",
            matchDate: "2026-05-02",
            status: "open",
            bucket: "this_week",
          }),
          mk({
            matchDayId: "sun-md",
            matchDate: "2026-05-03",
            status: "open",
            bucket: "this_week",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("squad-match-day-row-sat-md")).toBeTruthy();
    expect(screen.getByTestId("squad-match-day-row-sun-md")).toBeTruthy();
    expect(screen.getByTestId("md-cta-submit-sat-md")).toBeTruthy();
    expect(screen.getByTestId("md-cta-submit-sun-md")).toBeTruthy();
    // Neither row carries the collapsed "Weekend · May 2-3" label.
    expect(screen.queryByText(/Weekend · /)).toBeNull();
  });

  it("falls back to View CTA on a REJECTED submission when window is open via ambient pre-deadline (no force-open)", () => {
    render(
      <SquadMatchDayPicker
        items={[
          mk({
            matchDayId: "ambient-rej-1",
            matchDate: "2026-04-29",
            status: "submitted",
            validationStatus: "rejected",
            submittedAt: "2026-04-28T08:00:00Z",
            windowOpen: true,
            forceOpen: false,
            bucket: "this_week",
          }),
        ]}
      />,
    );
    // Without force-open the legacy gate applies — rejected stays pinned
    // for the admin reopen path.
    expect(screen.getByTestId("md-cta-view-ambient-rej-1")).toBeTruthy();
    expect(screen.queryByTestId("md-cta-edit-ambient-rej-1")).toBeNull();
  });
});
