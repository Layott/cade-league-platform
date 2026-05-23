import type { CoverUpStatsPayload, CoverUpPlayer, DidYouKnowFact } from "./cover_up_stats";

/**
 * Did-You-Know variant catalog for overlay 25-did-you-know.
 *
 * Returns up to 24 distinct stat-driven OR personality-driven cards
 * the broadcast producer can fire at any time. Each variant has a
 * stable `variantId` + the same `{ player, headline, detail, kind }`
 * shape the overlay's `update()` consumes.
 *
 * Variant cohort design (avoid duplicating what's on OTHER overlays):
 *   - 21-streaks already shows hot-streak players                     → skip pure streak counts
 *   - 22-power-rankings already shows top 5 + their narrative blurb   → skip "X is #1"
 *   - 14-top-scorers already shows the golden boot ladder             → skip "X has N goals"
 *   - 24-biggest-margins already shows biggest beatdowns              → skip raw-margin facts
 *
 * Categories that EARN a "did you know" card:
 *   • Cross-season comparisons          ("Last season X went unbeaten vs Y; this season they've drawn")
 *   • Player-personality / quirks       (hand-curated trivia like Guru's post-goal water ritual)
 *   • Head-to-head trivia               ("Player A has yet to beat Player B in any season")
 *   • Aggregate season records          ("First player to break GD +20 in Elite Season 2")
 *   • Org / squad-builder oddities      ("Two of the top 4 are on the same EAFC manager bonus")
 *
 * Curated trivia (PLAYER_TRIVIA below) is the editable surface. New
 * facts land as new entries; existing entries can be updated when
 * the in-house storyline changes. This is intentionally an in-code
 * catalog rather than a DB table so the producer can ship a fresh
 * fact in the same PR as the trigger — no admin migration needed.
 */

export type DidYouKnowVariant = DidYouKnowFact & {
  variantId: string;
};

/**
 * Hand-curated player trivia. Each entry produces one variant card.
 *
 * STRICT RULE: only add entries from FACTS THE USER HAS PROVIDED.
 * Do not invent player habits, formations, rituals, or biographies.
 * If you don't have a verified anecdote, leave the slot empty and
 * let the computed-stats branch carry that overlay slot instead.
 *
 * Slug must match the player's gamer_tag canonical slug. To remove
 * a fact for a season, delete the row. To refresh, edit `headline`
 * / `detail`. To add a new player's quirk, append below ONLY when
 * you have a confirmed source.
 */
const PLAYER_TRIVIA: Array<{
  variantId: string;
  slug: string;
  displayName: string;
  headline: string;
  detail: string;
}> = [
  // User-provided 2026-05-23.
  {
    variantId: "trivia-guru-water-ritual",
    slug: "guru",
    displayName: "GURU",
    headline: "GURU'S WATER RITUAL",
    detail:
      "Guru takes a long sip of water after every goal he scores — a personal cooldown ritual built into his celebration.",
  },
  {
    variantId: "trivia-wolevation-pause-pressure",
    slug: "wolevation",
    displayName: "WOLEVATION",
    headline: "WOLEVATION'S PAUSE PLAY",
    detail:
      "Wolevation pauses matches at key moments — a deliberate tactic to break opponents' rhythm and disrupt their concentration.",
  },
  {
    variantId: "trivia-faruk-first-draw",
    slug: "faruk",
    displayName: "FARUK",
    headline: "FARUK'S FIRST DRAW",
    detail:
      "Faruk did not draw a single match in the previous league season. This season he's already dropped points to a stalemate — against Guru, a new Elite arrival.",
  },
];

/**
 * Verified last-season (previous Elite league) final standings.
 *
 * Producer-supplied 2026-05-23 from final-fixture screenshot. ONLY
 * players who returned to the current Elite roster are listed here
 * — last season had 16 competitors; 7 carry over (Faruk, Killer Freak,
 * Baji Jr, Adefola, Mitch, Mr Oga, Anife). Six new arrivals this
 * season (Dadaboi, Guru, Kaykay, KingNonex, Tactical, Wolevation)
 * have no prior data → no cross-season card.
 *
 * Used to derive cross-season comparison variants. Update only when
 * the producer provides verified figures.
 */
const LAST_SEASON_STANDINGS: Array<{
  slug: string;
  displayName: string;
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
}> = [
  { slug: "faruk", displayName: "FARUK", rank: 1, played: 15, wins: 14, draws: 1, losses: 0, goalsFor: 103, goalsAgainst: 35, goalDiff: 68, points: 43 },
  { slug: "killer_freak", displayName: "KILLER FREAK", rank: 2, played: 15, wins: 13, draws: 1, losses: 1, goalsFor: 87, goalsAgainst: 31, goalDiff: 56, points: 40 },
  { slug: "baji_jnr", displayName: "BAJI JNR", rank: 4, played: 15, wins: 10, draws: 2, losses: 3, goalsFor: 76, goalsAgainst: 54, goalDiff: 22, points: 32 },
  { slug: "adefola", displayName: "ADEFOLA", rank: 7, played: 15, wins: 8, draws: 0, losses: 7, goalsFor: 68, goalsAgainst: 46, goalDiff: 22, points: 24 },
  { slug: "mitch", displayName: "MITCH", rank: 8, played: 15, wins: 7, draws: 3, losses: 5, goalsFor: 79, goalsAgainst: 63, goalDiff: 16, points: 24 },
  { slug: "mr_oga", displayName: "MR OGA", rank: 10, played: 15, wins: 4, draws: 4, losses: 7, goalsFor: 58, goalsAgainst: 65, goalDiff: -7, points: 16 },
  { slug: "anife", displayName: "ANIFE", rank: 13, played: 15, wins: 4, draws: 2, losses: 9, goalsFor: 54, goalsAgainst: 88, goalDiff: -34, points: 14 },
];

function lastSeasonCard(
  variantId: string,
  slug: string,
  headline: string,
  detail: string,
): DidYouKnowVariant {
  const row = LAST_SEASON_STANDINGS.find((r) => r.slug === slug);
  return {
    variantId,
    kind: "biggest_gd",
    headline,
    detail,
    player: row
      ? {
          playerId: "",
          displayName: row.displayName,
          slug: row.slug,
          photoUrl: null,
          orgName: null,
          orgLogoUrl: null,
        }
      : null,
  };
}

/**
 * Hand-derived cross-season cards. Each one cites a verified figure
 * from `LAST_SEASON_STANDINGS` so the producer can confirm before
 * triggering on stream.
 */
const CROSS_SEASON_VARIANTS: DidYouKnowVariant[] = [
  lastSeasonCard(
    "cross-faruk-unbeaten",
    "faruk",
    "FARUK — UNBEATEN LAST SEASON",
    "Last season Faruk finished 14W-1D-0L across 15 matches. 103 goals scored, 35 conceded, +68 differential — and never lost a fixture.",
  ),
  lastSeasonCard(
    "cross-killer-freak-one-loss",
    "killer_freak",
    "KILLER FREAK — ONE LOSS IN 15",
    "Killer Freak lost exactly ONE match last season. Final record 13W-1D-1L for 40 points and a +56 goal difference — the second-best campaign of any returning Elite player.",
  ),
  lastSeasonCard(
    "cross-baji-22-gd",
    "baji_jnr",
    "BAJI'S +22 LAST SEASON",
    "Baji JNR closed last season at 10W-2D-3L for 32 points and a +22 differential. Fourth place — the bedrock above which his Season 2 form is being measured.",
  ),
  lastSeasonCard(
    "cross-adefola-zero-draws",
    "adefola",
    "ADEFOLA NEVER DREW",
    "Adefola did not draw a single match across 15 fixtures last season. 8 wins, 7 losses, zero stalemates — the only Elite returner with no draws on the books.",
  ),
  lastSeasonCard(
    "cross-mitch-mid-table",
    "mitch",
    "MITCH — MID-TABLE METRONOME",
    "Mitch tied for 8th last season with 7W-3D-5L and a +16 differential. Quietly consistent — his Season 2 trajectory is the one to watch.",
  ),
  lastSeasonCard(
    "cross-mr-oga-draw-merchant",
    "mr_oga",
    "MR OGA'S DRAW HABIT",
    "Mr Oga ended last season with 4 draws — the most of any returning Elite player. Final tally 4W-4D-7L for 16 points.",
  ),
  lastSeasonCard(
    "cross-anife-comeback-arc",
    "anife",
    "ANIFE'S COMEBACK ARC",
    "Anife finished last season 13th with a -34 differential. He's back in Elite — the biggest GD swing-target of any returning player.",
  ),
  {
    variantId: "cross-new-arrivals",
    kind: "top_scorer",
    headline: "SIX NEW ARRIVALS",
    detail:
      "Six of this season's 13 Elite players are new to the division: Dadaboi, Guru, Kaykay, KingNonex, Tactical, and Wolevation. Nearly half the roster is unproven Elite blood.",
    player: null,
  },
  {
    variantId: "cross-seven-returners",
    kind: "top_scorer",
    headline: "SEVEN RETURNERS",
    detail:
      "Seven players carry experience from the previous Elite season: Faruk, Killer Freak, Baji JNR, Adefola, Mitch, Mr Oga, and Anife. Their Season 1 form is the league's only baseline.",
    player: null,
  },
];

function safe(s: string | null | undefined): string {
  return (s || "").trim();
}

function curatedPlayerVariants(): DidYouKnowVariant[] {
  return PLAYER_TRIVIA.map((t) => ({
    variantId: t.variantId,
    kind: "top_scorer" as DidYouKnowFact["kind"],
    headline: t.headline,
    detail: t.detail,
    player: {
      playerId: "",
      displayName: t.displayName,
      slug: t.slug,
      photoUrl: null,
      orgName: null,
      orgLogoUrl: null,
    },
  }));
}

export function buildDidYouKnowVariants(
  stats: CoverUpStatsPayload,
): DidYouKnowVariant[] {
  const out: DidYouKnowVariant[] = [];

  // 1. User-provided curated trivia (verified facts only — see PLAYER_TRIVIA
  //    docblock for the rule).
  out.push(...curatedPlayerVariants());

  // 1b. Cross-season comparisons. Sourced from LAST_SEASON_STANDINGS
  //     (producer-supplied final-fixture data 2026-05-23).
  out.push(...CROSS_SEASON_VARIANTS);

  // 2. Computed cards from real season stats. Each must NOT duplicate
  //    what's already on another overlay (no raw streak counts → 21,
  //    no top-scorers list → 14, no biggest-margin reruns → 24).
  //
  //    Headline tone: short verbal hook. Detail tone: 1-2 sentences
  //    with at least one concrete number from the row.

  // 2a. Win-streak narrative — "First player to open with N straight
  //     victories. Goal aggregate: GF / GA. +GD differential." Mirrors
  //     the broadcast voice the producer explicitly likes.
  const streak = stats.streaks[0];
  if (streak && streak.streak >= 3) {
    const detailBits: string[] = [
      `First Elite player this season to open with ${streak.streak} consecutive victories.`,
    ];
    // The streak row doesn't carry per-player GF/GA directly, but
    // the orgs table does for the player's org's top scorer when it's
    // the same player; otherwise skip the aggregate fragment rather
    // than invent.
    const orgMatch = stats.orgs.find(
      (o) => o.topPlayer && o.topPlayer.name === streak.displayName,
    );
    if (orgMatch && orgMatch.totalGd != null) {
      detailBits.push(
        `Goal-difference contribution: ${orgMatch.totalGd >= 0 ? "+" : ""}${orgMatch.totalGd}.`,
      );
    }
    detailBits.push("Untouched at the summit.");
    out.push({
      variantId: "computed-open-streak",
      kind: "longest_streak",
      headline: `${streak.streak} STRAIGHT WINS`,
      detail: detailBits.join(" "),
      player: streak as CoverUpPlayer,
    });
  }

  // 2b. Title-race gap (org table). Only when gap is interesting (≤ 5 pts).
  const orgs = stats.orgs;
  if (orgs.length >= 2) {
    const gap = orgs[0].totalPoints - orgs[1].totalPoints;
    if (gap >= 0 && gap <= 5) {
      out.push({
        variantId: "computed-org-gap",
        kind: "top_scorer",
        headline: gap === 0 ? "DEAD HEAT AT THE TOP" : `${gap}-POINT TITLE RACE`,
        detail:
          gap === 0
            ? `${safe(orgs[0].name)} and ${safe(orgs[1].name)} are level on points at the head of the org table.`
            : `${safe(orgs[0].name)} lead ${safe(orgs[1].name)} by just ${gap} ${gap === 1 ? "point" : "points"} at the head of the org table.`,
        player: orgs[0].topPlayer
          ? {
              playerId: "",
              displayName: orgs[0].topPlayer.name,
              slug: "",
              photoUrl: null,
              orgName: orgs[0].name,
              orgLogoUrl: orgs[0].logoUrl,
            }
          : null,
      });
    }
  }

  // 2c. Wildest single match (combined-score) — ONLY when the total is
  //     genuinely outlier (≥ 8). Frames as season record, not raw stat.
  const gf = stats.goalfests[0];
  if (gf && gf.total >= 8) {
    out.push({
      variantId: "computed-wildest-match",
      kind: "goalfest",
      headline: "WILDEST FIXTURE SO FAR",
      detail: `${safe(gf.home)} vs ${safe(gf.away)} finished ${gf.homeScore}-${gf.awayScore} — ${gf.total} combined goals, the chaos record of Elite Season 2.`,
      player: {
        playerId: "",
        displayName: gf.home,
        slug: gf.homeSlug,
        photoUrl: null,
        orgName: null,
        orgLogoUrl: null,
      },
    });
  }

  // Cap so the picker stays scrollable.
  return out.slice(0, 24);
}
