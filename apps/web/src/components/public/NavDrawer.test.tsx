import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createRef } from "react";
import { NavDrawer, HamburgerNav } from "./NavDrawer";

// next/navigation's usePathname is the only next dep the component reaches for.
// Stub it so RTL can render without a full router provider.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// next/link in this codebase just renders an <a>; mock it to avoid loading
// the real module (and its router context).
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  } & Record<string, unknown>) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => cleanup());

describe("NavDrawer (Plan 46)", () => {
  const noop = () => undefined;

  function renderOpen(
    props: Partial<React.ComponentProps<typeof NavDrawer>> = {},
  ) {
    const triggerRef = createRef<HTMLButtonElement>();
    return render(
      <NavDrawer
        open
        onClose={noop}
        triggerRef={triggerRef}
        roles={[]}
        isStaff={false}
        authenticated={false}
        {...props}
      />,
    );
  }

  it("renders nothing when closed", () => {
    const triggerRef = createRef<HTMLButtonElement>();
    const { container } = render(
      <NavDrawer
        open={false}
        onClose={noop}
        triggerRef={triggerRef}
        roles={[]}
        isStaff={false}
        authenticated={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("always renders the Public group", () => {
    renderOpen();
    expect(screen.getByTestId("nav-drawer-group-public")).toBeTruthy();
    expect(screen.getByTestId("nav-drawer-link-/")).toBeTruthy();
    expect(screen.getByTestId("nav-drawer-link-/fixtures")).toBeTruthy();
    expect(screen.getByTestId("nav-drawer-link-/punishments")).toBeTruthy();
  });

  it("hides Player group when user has no player role", () => {
    renderOpen({ authenticated: true, roles: ["viewer"] });
    expect(screen.queryByTestId("nav-drawer-group-player")).toBeNull();
  });

  it("shows Player group when user has player role + is authenticated", () => {
    renderOpen({ authenticated: true, roles: ["player"] });
    expect(screen.getByTestId("nav-drawer-group-player")).toBeTruthy();
    expect(screen.getByTestId("nav-drawer-link-/player/squad")).toBeTruthy();
    // UI Audit Slice 2 (2026-04-28) — disputes + appeals merged into
    // a single /player/cases entry. Old /player/appeals + /player/disputes
    // links are removed from the drawer (paths still 307 to the new route).
    expect(screen.getByTestId("nav-drawer-link-/player/cases")).toBeTruthy();
    expect(screen.queryByTestId("nav-drawer-link-/player/appeals")).toBeNull();
    expect(screen.queryByTestId("nav-drawer-link-/player/disputes")).toBeNull();
  });

  it("hides Staff group when isStaff is false", () => {
    renderOpen({ authenticated: true, roles: ["player"] });
    expect(screen.queryByTestId("nav-drawer-group-staff")).toBeNull();
  });

  it("shows Staff group when isStaff is true", () => {
    renderOpen({ authenticated: true, isStaff: true, roles: ["admin"] });
    expect(screen.getByTestId("nav-drawer-group-staff")).toBeTruthy();
    expect(screen.getByTestId("nav-drawer-link-/admin")).toBeTruthy();
    // UI Audit Slice 4 (2026-04-28) — Staff group collapsed to 8 hubs.
    // /admin/match-days remains a hub URL; /admin/trash now lives under
    // the System hub at /admin/system. Old paths 307 to the new ones.
    expect(
      screen.getByTestId("nav-drawer-link-/admin/match-days"),
    ).toBeTruthy();
    expect(screen.getByTestId("nav-drawer-link-/admin/system")).toBeTruthy();
    expect(screen.queryByTestId("nav-drawer-link-/admin/trash")).toBeNull();
  });

  it("shows Referee group for referees, admins, and moderators", () => {
    const ref = renderOpen({ authenticated: true, roles: ["referee"] });
    expect(screen.getByTestId("nav-drawer-group-referee")).toBeTruthy();
    expect(
      screen.getByTestId("nav-drawer-link-/referee/attendance"),
    ).toBeTruthy();
    ref.unmount();

    renderOpen({ authenticated: true, isStaff: true, roles: ["moderator"] });
    expect(screen.getByTestId("nav-drawer-group-referee")).toBeTruthy();
  });

  it("hides Referee group for players and viewers", () => {
    renderOpen({ authenticated: true, roles: ["player"] });
    expect(screen.queryByTestId("nav-drawer-group-referee")).toBeNull();
  });

  it("closes when Escape is pressed", () => {
    const onClose = vi.fn();
    const triggerRef = createRef<HTMLButtonElement>();
    render(
      <NavDrawer
        open
        onClose={onClose}
        triggerRef={triggerRef}
        roles={[]}
        isStaff={false}
        authenticated={false}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const triggerRef = createRef<HTMLButtonElement>();
    render(
      <NavDrawer
        open
        onClose={onClose}
        triggerRef={triggerRef}
        roles={[]}
        isStaff={false}
        authenticated={false}
      />,
    );
    fireEvent.click(screen.getByTestId("nav-drawer-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("HamburgerNav (Plan 46)", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders a hamburger trigger that opens + closes the drawer", () => {
    render(
      <HamburgerNav roles={["referee"]} isStaff={false} authenticated={true} />,
    );
    const trigger = screen.getByTestId("nav-drawer-trigger");
    expect(trigger).toBeTruthy();
    // Drawer always mounts (for slide animation) — closed state is signalled
    // by aria-hidden=true + translate-x-full, not by unmount.
    expect(screen.getByTestId("nav-drawer").getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(trigger);
    expect(screen.getByTestId("nav-drawer").getAttribute("aria-hidden")).toBe("false");
    expect(screen.getByTestId("nav-drawer-group-referee")).toBeTruthy();

    fireEvent.click(screen.getByTestId("nav-drawer-close"));
    expect(screen.getByTestId("nav-drawer").getAttribute("aria-hidden")).toBe("true");
  });

  it("restores focus to the trigger when the drawer closes via ESC", () => {
    render(
      <HamburgerNav roles={[]} isStaff={false} authenticated={false} />,
    );
    const trigger = screen.getByTestId("nav-drawer-trigger") as HTMLButtonElement;
    fireEvent.click(trigger);
    // After open, focus should sit inside the panel (first link).
    expect(document.activeElement).not.toBe(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    // Focus restores to the trigger.
    expect(document.activeElement).toBe(trigger);
  });
});
