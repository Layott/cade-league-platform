import type { CoverUpStatsPayload, CoverUpPlayer, DidYouKnowFact } from "./cover_up_stats";
import {
  LAST_SEASON_STANDINGS,
  fmtSigned,
  type CurrentPlayerStat as SharedCurrentPlayerStat,
} from "./season_history";

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
    variantId: "trivia-faruk-draw-parallel",
    slug: "faruk",
    displayName: "FARUK",
    headline: "FARUK'S DRAW PARALLEL",
    detail:
      "Faruk drew exactly one match across his 15-game campaign last season. This season is already mirroring it — one draw on the books, against Guru, a new Elite arrival.",
  },
];

export type CurrentPlayerStat = SharedCurrentPlayerStat;

function diff(curr: number, prev: number): string {
  const d = curr - prev;
  if (d === 0) return "matching last season's mark exactly";
  if (d > 0) return `up ${d} on last season's pace`;
  return `down ${Math.abs(d)} from last season's pace`;
}

/**
 * Build cross-season comparison cards. Each card pairs a verified
 * last-season figure with the player's CURRENT live-season figure
 * from the standings table. Cards short-circuit when current data
 * isn't yet available for that player (early-season state).
 */
function crossSeasonComparisons(
  current: Map<string, CurrentPlayerStat>,
): DidYouKnowVariant[] {
  const out: DidYouKnowVariant[] = [];

  for (const last of LAST_SEASON_STANDINGS) {
    const now = current.get(last.slug);
    if (!now || now.played === 0) continue;

    const playerRef: CoverUpPlayer = {
      playerId: "",
      displayName: last.displayName,
      slug: last.slug,
      photoUrl: null,
      orgName: null,
      orgLogoUrl: null,
    };

    // Player-specific paired angle.
    if (last.slug === "faruk") {
      // Drew exactly 1 last season; flag the same-draw parallel when
      // this season has matched.
      if (now.draws === last.draws) {
        out.push({
          variantId: "cross-faruk-draw-parallel",
          kind: "biggest_gd",
          headline: "FARUK'S DRAW PARALLEL",
          detail: `Faruk drew ${last.draws} match last season across his 15-game unbeaten run. ${now.played} games into this season he's already drawn ${now.draws} — matching the pace exactly.`,
          player: playerRef,
        });
      }
      // Unbeaten check.
      out.push({
        variantId: "cross-faruk-loss-watch",
        kind: "biggest_gd",
        headline:
          now.losses === 0
            ? "FARUK STILL UNBEATEN"
            : `FARUK'S ${now.losses}-LOSS RESET`,
        detail:
          now.losses === 0
            ? `Faruk went 14W-1D-0L last season — zero losses in 15. This season he's ${now.wins}W-${now.draws}D-0L across ${now.played} so the unbeaten streak rolls on.`
            : `Faruk never lost a match last season (14W-1D-0L). He's already taken ${now.losses} ${now.losses === 1 ? "loss" : "losses"} this season after ${now.played} fixtures.`,
        player: playerRef,
      });
    }

    if (last.slug === "killer_freak") {
      out.push({
        variantId: "cross-killer-freak-loss-pace",
        kind: "biggest_gd",
        headline: "KF'S ONE-LOSS BAR",
        detail: `Killer Freak lost ONE match all of last season (13W-1D-1L). ${now.played} games in this season he's at ${now.losses} ${now.losses === 1 ? "loss" : "losses"} — ${diff(now.losses, last.losses)}.`,
        player: playerRef,
      });
    }

    if (last.slug === "baji_jnr") {
      out.push({
        variantId: "cross-baji-gd-pace",
        kind: "biggest_gd",
        headline: "BAJI VS BAJI",
        detail: `Baji JNR closed last season at ${fmtSigned(last.goalDiff)} differential across 15 games. ${now.played} into this season he sits at ${fmtSigned(now.goalDiff)} — ${diff(now.goalDiff, Math.round(last.goalDiff * (now.played / last.played)))}.`,
        player: playerRef,
      });
    }

    if (last.slug === "adefola") {
      // last season ZERO draws. Flag the moment this season draws.
      out.push({
        variantId: "cross-adefola-first-draw",
        kind: "biggest_gd",
        headline:
          now.draws === 0
            ? "ADEFOLA — STILL NO DRAWS"
            : `ADEFOLA'S FIRST DRAW IN ELITE`,
        detail:
          now.draws === 0
            ? `Adefola went the entire previous season without a single draw (8W-0D-7L). ${now.played} matches into this season he's STILL drawn zero — the signature win-or-lose pattern continues.`
            : `Adefola did not draw a single match across 15 fixtures last season. After ${now.played} games this season he's already on ${now.draws} ${now.draws === 1 ? "draw" : "draws"} — a new look for a player who only ever wins or loses.`,
        player: playerRef,
      });
    }

    if (last.slug === "mitch") {
      out.push({
        variantId: "cross-mitch-pts-pace",
        kind: "biggest_gd",
        headline: "MITCH'S PACE",
        detail: `Mitch banked ${last.points} points last season (7W-3D-5L, ${fmtSigned(last.goalDiff)} GD). After ${now.played} matches this season he's on ${now.points} pts at ${fmtSigned(now.goalDiff)} — ${diff(now.points, Math.round(last.points * (now.played / last.played)))}.`,
        player: playerRef,
      });
    }

    if (last.slug === "mr_oga") {
      out.push({
        variantId: "cross-mr-oga-draws",
        kind: "biggest_gd",
        headline: "MR OGA'S DRAW LINE",
        detail: `Mr Oga led all returners in draws last season — 4 in 15 (4W-4D-7L). ${now.played} games into this season he's on ${now.draws} ${now.draws === 1 ? "draw" : "draws"} so far.`,
        player: playerRef,
      });
    }

    if (last.slug === "anife") {
      out.push({
        variantId: "cross-anife-gd-swing",
        kind: "biggest_gd",
        headline: "ANIFE'S GD ARC",
        detail: `Anife finished last season at ${fmtSigned(last.goalDiff)} GD — the worst differential of any returning Elite player. ${now.played} into this season he's at ${fmtSigned(now.goalDiff)} — ${diff(now.goalDiff, Math.round(last.goalDiff * (now.played / last.played)))}.`,
        player: playerRef,
      });
    }
  }

  // League-wide context cards (no per-player current data needed).
  out.push({
    variantId: "cross-new-arrivals",
    kind: "top_scorer",
    headline: "SIX NEW ARRIVALS",
    detail:
      "Six of this season's 13 Elite players are new to the division: Dadaboi, Guru, Kaykay, KingNonex, Tactical, and Wolevation. Nearly half the roster is unproven Elite blood.",
    player: null,
  });
  out.push({
    variantId: "cross-seven-returners",
    kind: "top_scorer",
    headline: "SEVEN RETURNERS",
    detail:
      "Seven players carry experience from the previous Elite season: Faruk, Killer Freak, Baji JNR, Adefola, Mitch, Mr Oga, and Anife. Their Season 1 form is the league's only baseline.",
    player: null,
  });

  return out;
}

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
  currentStandings: Map<string, CurrentPlayerStat> = new Map(),
): DidYouKnowVariant[] {
  const out: DidYouKnowVariant[] = [];

  // 1. User-provided curated trivia (verified facts only — see PLAYER_TRIVIA
  //    docblock for the rule).
  out.push(...curatedPlayerVariants());

  // 1b. Cross-season comparisons. Each PAIRS last-season verified data
  //     with the player's live current-season figure from standings.
  //     Cards short-circuit per player when their current row is empty.
  out.push(...crossSeasonComparisons(currentStandings));

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
