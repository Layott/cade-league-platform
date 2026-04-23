import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import WelcomePage from "./page";

// next/image ships a full-blown <img> component with srcSet logic + loaders.
// For RTL we just want a minimal stub that renders src/alt so we can assert
// the logos + partner marks are present.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    ...rest
  }: {
    src: string;
    alt: string;
  } & Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img src={src} alt={alt} {...rest} />;
  },
}));

// next/link in tests just renders an <a>; avoids dragging the real router
// context into a server-component's render path.
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

// NavDrawer should NOT render on /welcome — but the page has no way to pull
// it in directly, so we just make sure the page itself does not reference
// a nav-drawer-trigger or nav-drawer-group-public testid.

afterEach(() => cleanup());

describe("/welcome landing page", () => {
  it("renders the sign-in button that links to /login", () => {
    render(<WelcomePage />);
    const signin = screen.getByTestId("welcome-signin");
    expect(signin).toBeTruthy();
    expect(signin.getAttribute("href")).toBe("/login");
    expect(signin.textContent ?? "").toMatch(/Sign in/i);
  });

  it("renders a public-site link forwarding ?nolanding=1", () => {
    render(<WelcomePage />);
    const pub = screen.getByTestId("welcome-public-link");
    expect(pub).toBeTruthy();
    expect(pub.getAttribute("href")).toBe("/?nolanding=1");
  });

  it("renders CADE + GameEvo primary logos", () => {
    render(<WelcomePage />);
    // Both images are exposed via alt text (`CADE esports`, `GameEvo`).
    expect(screen.getByAltText(/CADE/i)).toBeTruthy();
    expect(screen.getByAltText(/GameEvo/i)).toBeTruthy();
  });

  it("renders the partner logos strip", () => {
    render(<WelcomePage />);
    const partners = screen.getByTestId("welcome-partners");
    expect(partners).toBeTruthy();
    // Each of the three partner marks is present via alt text.
    expect(screen.getByAltText(/Gamepride/i)).toBeTruthy();
    expect(screen.getByAltText(/Trace TV/i)).toBeTruthy();
    expect(screen.getByAltText(/Esports Africa News/i)).toBeTruthy();
  });

  it("does NOT render the global nav drawer trigger", () => {
    render(<WelcomePage />);
    // SiteChromeClient hides itself on /welcome (HIDDEN_PREFIXES). In RTL
    // we render the page in isolation, so by asserting the drawer's
    // testid is absent we also guard against an accidental in-page import
    // of HamburgerNav.
    expect(screen.queryByTestId("nav-drawer-trigger")).toBeNull();
    expect(screen.queryByTestId("nav-drawer-group-public")).toBeNull();
  });

  it("includes the season tagline", () => {
    render(<WelcomePage />);
    expect(screen.getByText(/Division 1 Elite — 2025\/2026 season\./)).toBeTruthy();
  });
});
