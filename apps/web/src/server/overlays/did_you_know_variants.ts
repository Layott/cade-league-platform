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
 * Slug must match the player's gamer_tag canonical slug. To remove a
 * fact for a season, delete the row. To refresh, edit `headline` /
 * `detail`. To add a new player's quirk, append below.
 *
 * Naming + tone: production-ready broadcast copy. Headline = the
 * hook, 5 words or less. Detail = 1-2 sentences of context. Avoid
 * negative framing of any player who's still active in the league.
 */
const PLAYER_TRIVIA: Array<{
  variantId: string;
  slug: string;
  displayName: string;
  headline: string;
  detail: string;
}> = [
  // Pre-match / post-match rituals + personality quirks.
  {
    variantId: "trivia-guru-water-ritual",
    slug: "guru",
    displayName: "GURU",
    headline: "GURU'S WATER RITUAL",
    detail:
      "After every goal Guru pauses to take a long sip of water before celebrating — a personal cooldown ritual he says keeps his head in the match.",
  },
  {
    variantId: "trivia-wolevation-pause-pressure",
    slug: "wolevation",
    displayName: "WOLEVATION",
    headline: "WOLEVATION'S PAUSE PRESSURE",
    detail:
      "Wolevation has built a reputation for pausing matches at high-pressure moments — opponents say the rhythm break is half of why his late-game record is so strong.",
  },
  {
    variantId: "trivia-faruk-vs-guru-cross-season",
    slug: "faruk",
    displayName: "FARUK",
    headline: "FARUK'S GURU PROBLEM",
    detail:
      "Faruk swept every Season 1 head-to-head against Guru. Season 2 has flipped — they drew their first meeting, and Guru is now within points striking distance.",
  },
  {
    variantId: "trivia-baji-jnr-late-shifter",
    slug: "baji_jnr",
    displayName: "BAJI JNR",
    headline: "BAJI'S 70TH-MINUTE SHIFT",
    detail:
      "Baji JNR has scored an unusually high share of his goals after the 70th minute. Opponents call it the late shift — he closes matches harder than he opens them.",
  },
  {
    variantId: "trivia-anife-afrobeat-warmup",
    slug: "anife",
    displayName: "ANIFE",
    headline: "ANIFE'S AFROBEAT WARM-UP",
    detail:
      "Anife refuses to start a match without his pre-game Afrobeat playlist queued. The studio booth has it cued before he sits down.",
  },
  {
    variantId: "trivia-kaykay-formation-swap",
    slug: "kaykay",
    displayName: "KAYKAY",
    headline: "KAYKAY'S MIDGAME FORMATION SWAP",
    detail:
      "Kaykay is the only Elite player who has switched formations mid-match in every single fixture so far this season — usually from 4-3-3 to 4-2-2-2 the moment he concedes.",
  },
  {
    variantId: "trivia-mr-oga-zero-yellow",
    slug: "mr_oga",
    displayName: "MR OGA",
    headline: "MR OGA — STILL UNBOOKED",
    detail:
      "Mr Oga has not received a single yellow card across his last 14 league matches. The cleanest tackler in the division.",
  },
  {
    variantId: "trivia-dadaboi-bottom-rebound",
    slug: "dadaboi",
    displayName: "DADABOI",
    headline: "DADABOI'S BOTTOM-FIVE BOUNCE",
    detail:
      "Dadaboi has finished bottom-five in three of his first four match-days, then bounced into the top-half by Friday of every one of those weeks. His comeback discipline is a league benchmark.",
  },
  {
    variantId: "trivia-mitch-cards-collector",
    slug: "mitch",
    displayName: "MITCH",
    headline: "MITCH'S MANAGER MAGNET",
    detail:
      "Mitch's squad has used 6 different EAFC managers this season alone — the most rotational coaching staff in Elite. Chemistry shows it.",
  },
  {
    variantId: "trivia-tactical-name-mismatch",
    slug: "tactical",
    displayName: "TACTICAL",
    headline: "TACTICAL — UNLIKE THE NAME",
    detail:
      "Despite the gamer tag, Tactical scores 64% of his goals from open-play counters — the most counter-heavy player in the league.",
  },
  {
    variantId: "trivia-killer-freak-rttf-army",
    slug: "killer_freak",
    displayName: "KILLER FREAK",
    headline: "RTTF ARMY",
    detail:
      "Killer Freak fields more Road-to-the-Final cards than any other Elite squad this season — 4 starters carry RTTF dynamic ratings.",
  },
  {
    variantId: "trivia-kingnonex-night-owl",
    slug: "kingnonex",
    displayName: "KINGNONEX",
    headline: "KINGNONEX OWNS THE LATE SLOT",
    detail:
      "Every win KingNonex has this season has come in the 9pm or later kickoff. The night-slot Elite specialist.",
  },
  {
    variantId: "trivia-adefola-iconic-builder",
    slug: "adefola",
    displayName: "ADEFOLA",
    headline: "ICON-HEAVY",
    detail:
      "Adefola's squad averages more Icon-card items per match than any other Elite roster — a deliberate nostalgia tilt the rest of the league hasn't matched.",
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

  // 1. League-wide derived oddities (avoid duplicating other overlays).

  // Tightest gap between rank 1 + rank 2 (where the title race actually is).
  // org-standings overlay shows the table, not the gap narrative.
  const orgs = stats.orgs;
  if (orgs.length >= 2) {
    const gap = orgs[0].totalPoints - orgs[1].totalPoints;
    out.push({
      variantId: "org-gap",
      kind: "top_scorer",
      headline: `${gap}-POINT TITLE RACE`,
      detail: `${safe(orgs[0].name)} lead ${safe(orgs[1].name)} by just ${gap} ${gap === 1 ? "point" : "points"} at the top of the org table — closest gap in any league this season.`,
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

  // Org with the LONGEST roster (squad-builder oddity).
  const longestRoster = [...orgs].sort((a, b) => b.playerCount - a.playerCount)[0];
  if (longestRoster && longestRoster.playerCount >= 2) {
    out.push({
      variantId: "longest-org-roster",
      kind: "top_scorer",
      headline: `${longestRoster.playerCount}-DEEP STABLE`,
      detail: `${safe(longestRoster.name)} field ${longestRoster.playerCount} players in Elite this season — the deepest competitive stable of any org.`,
      player: longestRoster.topPlayer
        ? {
            playerId: "",
            displayName: longestRoster.topPlayer.name,
            slug: "",
            photoUrl: null,
            orgName: longestRoster.name,
            orgLogoUrl: longestRoster.logoUrl,
          }
        : null,
    });
  }

  // Combined-score record (highest goalfest) but framed as oddity, not raw stat.
  const gf = stats.goalfests[0];
  if (gf && gf.total >= 8) {
    out.push({
      variantId: "wildest-match",
      kind: "goalfest",
      headline: "WILDEST MATCH SO FAR",
      detail: `${safe(gf.home)} vs ${safe(gf.away)} produced ${gf.total} combined goals — the most chaotic single fixture in Elite Season 2.`,
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

  // 2. Curated player trivia (hardcoded; producer adds new ones in code).
  out.push(...curatedPlayerVariants());

  // Cap so the picker stays scrollable but not overwhelming.
  return out.slice(0, 24);
}
