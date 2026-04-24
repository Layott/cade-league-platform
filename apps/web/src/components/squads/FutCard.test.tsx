import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FutCard } from "./FutCard";
import type { CardSearchResult } from "@/server/fcdb/search";

function mkCard(over: Partial<CardSearchResult> = {}): CardSearchResult {
  return {
    id: "id-x",
    slug: "lionel_messi",
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
    cardBgUrl: null,
    variant: null,
    mainStats: null,
    weakFoot: null,
    skillMoves: null,
    metaRating: null,
    futbinNationId: null,
    futbinLeagueId: null,
    futbinClubId: null,
    ...over,
  };
}

describe("FutCard", () => {
  it("renders the add-slot placeholder when card is null", () => {
    render(<FutCard card={null} />);
    expect(screen.getByText(/Add/i)).toBeTruthy();
  });

  it("renders the solid-band fallback when no image + no variant", () => {
    render(<FutCard card={mkCard({ cardImageUrl: null, cardBgUrl: null, variant: null })} />);
    // No <img> elements because neither portrait nor frame URL available
    expect(document.querySelector("img")).toBeNull();
  });

  it("falls back to rating-band tile when cardBgUrl absent (no synthesis)", () => {
    // Futbin frames require imgix-signed URLs we can't mint client-side.
    // When cardBgUrl is null the card renders the solid-colour band + the
    // variant label; no img element is emitted.
    render(<FutCard card={mkCard({ variant: "5-toty", cardBgUrl: null })} />);
    const imgs = document.querySelectorAll("img");
    expect(imgs.length).toBe(0);
    expect(screen.getByText("5-toty")).toBeTruthy();
  });

  it("renders portrait + frame when both cardImageUrl and cardBgUrl are present", () => {
    const portrait = "https://cdn3.futbin.com/content/fifa26/img/players/p231747.png";
    const frame = "https://cdn.futbin.com/cards/s26/5-toty.webp";
    render(
      <FutCard
        card={mkCard({
          cardImageUrl: portrait,
          cardBgUrl: frame,
          variant: "5-toty",
        })}
        size="md"
      />,
    );
    const imgs = document.querySelectorAll("img");
    expect(imgs.length).toBe(2);
    // Frame is rendered first so it sits behind the portrait.
    expect(imgs[0].getAttribute("src")).toBe(frame);
    expect(imgs[1].getAttribute("src")).toBe(portrait);
    expect(screen.getByText("5-toty")).toBeTruthy();
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
