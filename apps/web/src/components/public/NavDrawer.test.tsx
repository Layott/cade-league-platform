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
    expect(screen.getByTestId("nav-drawer-link-/player/appeals")).toBeTruthy();
  });

  it("hides Staff group when isStaff is false", () => {
    renderOpen({ authenticated: true, roles: ["player"] });
    expect(screen.queryByTestId("nav-drawer-group-staff")).toBeNull();
  });

  it("shows Staff group when isStaff is true", () => {
    renderOpen({ authenticated: true, isStaff: true, roles: ["admin"] });
    expect(screen.getByTestId("nav-drawer-group-staff")).toBeTruthy();
    expect(screen.getByTestId("nav-drawer-link-/admin")).toBeTruthy();
    expect(
      screen.getByTestId("nav-drawer-link-/admin/match-days"),
    ).toBeTruthy();
    expect(screen.getByTestId("nav-drawer-link-/admin/trash")).toBeTruthy();
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
    expect(screen.queryByTestId("nav-drawer")).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByTestId("nav-drawer")).toBeTruthy();
    // Referee gets the Referee group
    expect(screen.getByTestId("nav-drawer-group-referee")).toBeTruthy();

    fireEvent.click(screen.getByTestId("nav-drawer-close"));
    expect(screen.queryByTestId("nav-drawer")).toBeNull();
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
