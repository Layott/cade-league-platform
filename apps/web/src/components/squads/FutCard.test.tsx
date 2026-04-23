import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FutCard } from "./FutCard";
import type { CardSearchResult } from "@/server/fcdb/search";

function mkCard(over: Partial<CardSearchResult> = {}): CardSearchResult {
  return {
    id: "id-x",
    name: "Lionel Messi",
    rating: 94,
    position: "RW",
    positionsAlt: ["CAM"],
    club: "Inter Miami",
    league: "MLS",
    nation: "Argentina",
    nationIso: "AR",
    itemType: "icon",
    priceCoins: 125_000,
    cardImageUrl: null,
    variant: null,
    ...over,
  };
}

describe("FutCard", () => {
  it("renders the add-slot placeholder when card is null", () => {
    render(<FutCard card={null} />);
    expect(screen.getByText(/Add/i)).toBeTruthy();
  });

  it("renders the solid-band fallback when cardImageUrl is absent", () => {
    render(<FutCard card={mkCard({ cardImageUrl: null, variant: "Icon" })} />);
    // No <img> element because imageUrl is absent
    expect(document.querySelector("img")).toBeNull();
    // Variant label is shown
    expect(screen.getByText("Icon")).toBeTruthy();
  });

  it("renders the FUT card art when cardImageUrl is present", () => {
    const url =
      "https://game-assets.fut.gg/cdn-cgi/image/quality=85,format=auto,width=300/2026/futgg-player-item-card/26-42.abc.webp";
    render(
      <FutCard
        card={mkCard({ cardImageUrl: url, variant: "Trophy Titans Hero" })}
        size="md"
      />,
    );
    const img = document.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe(url);
    // Variant label is rendered
    expect(screen.getByText("Trophy Titans Hero")).toBeTruthy();
  });

  it("sets a title attribute combining name, rating + variant", () => {
    render(
      <FutCard
        card={mkCard({ variant: "TOTY", cardImageUrl: null })}
        dataTestId="test-card"
      />,
    );
    const btn = screen.getByTestId("test-card");
    expect(btn.getAttribute("title")).toBe("Lionel Messi — 94 — TOTY");
  });

  it("falls back to 'Normal' in the title when no variant is supplied", () => {
    render(
      <FutCard
        card={mkCard({ variant: null, cardImageUrl: null })}
        dataTestId="no-variant-card"
      />,
    );
    const btn = screen.getByTestId("no-variant-card");
    expect(btn.getAttribute("title")).toBe("Lionel Messi — 94 — Normal");
  });
});
