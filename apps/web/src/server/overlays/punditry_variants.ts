import type {
  CoverUpStatsPayload,
  CoverUpPlayer,
  PunditryQuote,
} from "./cover_up_stats";
import {
  LAST_SEASON_STANDINGS,
  fmtSigned,
  type CurrentPlayerStat,
} from "./season_history";

/**
 * Punditry quote variant catalog for overlay 28-punditry.
 *
 * Same authoring rule as did-you-know:
 *   • Curated entries (PUNDIT_QUOTES) — broadcaster-voice lines anchored
 *     to VERIFIED facts only. No invented opinions.
 *   • Paired cross-season cards — pair last-season verified figures with
 *     this-season's live numbers from standings.
 *   • Auto-headline branch — surfaces the cover_up_stats computed quote
 *     as one option among many.
 */

export type PunditryVariant = PunditryQuote & {
  variantId: string;
};

/**
 * Hand-curated pundit quotes. Each entry is a broadcast line tied to a
 * verified figure — last-season finishes, position, GD, points, etc.
 *
 * STRICT RULE: only add entries that cite numbers / facts from
 * LAST_SEASON_STANDINGS or user-confirmed sources. No invented
 * opinions or personality traits.
 */
const PUNDIT_QUOTES: Array<{
  variantId: string;
  text: string;
  author: string;
  role: string;
  playerSlug?: string;
  playerDisplayName?: string;
}> = [
  // ─── League-wide narrative cards ─────────────────────────────
  {
    variantId: "pundit-returners-vs-new",
    text: "SEVEN OF THESE PLAYERS HAVE TASTED ELITE BEFORE. SIX HAVEN'T. THIS SEASON IS DEFINED BY THAT GAP.",
    author: "CADE PUNDIT DESK",
    role: "SEASON OPENING",
  },
  {
    variantId: "pundit-faruk-target",
    text: "FARUK FINISHED LAST SEASON 14-1-0. EVERY OPPONENT NOW PLAYS HIM WITH A TARGET ON THEIR JERSEY.",
    author: "ANALYST CORNER",
    role: "ELITE WATCH",
    playerSlug: "faruk",
    playerDisplayName: "FARUK",
  },
  {
    variantId: "pundit-faruk-103-goals",
    text: "FARUK SCORED 103 GOALS LAST SEASON IN 15 GAMES. NEARLY 7 PER MATCH. THE BAR IS SET ABSURDLY HIGH.",
    author: "CADE PUNDIT DESK",
    role: "ELITE WATCH",
    playerSlug: "faruk",
    playerDisplayName: "FARUK",
  },
  {
    variantId: "pundit-killer-freak-one-loss",
    text: "KILLER FREAK LOST ONE MATCH ALL OF LAST SEASON. ONE. THAT'S THE BAR ELITE PLAYS UNDER NOW.",
    author: "CADE PUNDIT DESK",
    role: "ELITE WATCH",
    playerSlug: "killer_freak",
    playerDisplayName: "KILLER FREAK",
  },
  {
    variantId: "pundit-baji-jr-second-act",
    text: "BAJI JR FINISHED FOURTH WITH 32 POINTS LAST SEASON. THE QUESTION ISN'T STAYING THERE — IT'S CLIMBING.",
    author: "CADE PUNDIT DESK",
    role: "ELITE WATCH",
    playerSlug: "baji_jnr",
    playerDisplayName: "BAJI JNR",
  },
  {
    variantId: "pundit-adefola-zero-draws",
    text: "ADEFOLA WENT 8-0-7 LAST SEASON. NOT A SINGLE DRAW IN 15 GAMES. HE EITHER WINS OR LOSES.",
    author: "ANALYST CORNER",
    role: "ELITE WATCH",
    playerSlug: "adefola",
    playerDisplayName: "ADEFOLA",
  },
  {
    variantId: "pundit-mitch-consistency",
    text: "MITCH BANKED 24 POINTS LAST SEASON ON A +16 DIFFERENTIAL. QUIETLY CONSISTENT — DANGER IN A LEAGUE THIS FAST.",
    author: "CADE PUNDIT DESK",
    role: "ELITE WATCH",
    playerSlug: "mitch",
    playerDisplayName: "MITCH",
  },
  {
    variantId: "pundit-mr-oga-draw-merchant",
    text: "MR OGA DREW 4 OF 15 MATCHES LAST SEASON. MORE THAN ANY OTHER RETURNING ELITE PLAYER. STALEMATE IS A SKILL.",
    author: "ANALYST CORNER",
    role: "ELITE WATCH",
    playerSlug: "mr_oga",
    playerDisplayName: "MR OGA",
  },
  {
    variantId: "pundit-anife-rebuild",
    text: "ANIFE FINISHED LAST SEASON ON A -34 GOAL DIFFERENTIAL. HE'S BACK IN ELITE. THE COMEBACK STORY EVERYONE WILL WATCH.",
    author: "ANALYST CORNER",
    role: "REBUILD WATCH",
    playerSlug: "anife",
    playerDisplayName: "ANIFE",
  },
  // ─── User-provided trivia (verified) ────────────────────────
  {
    variantId: "pundit-guru-arrival",
    text: "GURU ARRIVES WITH NO ELITE BAGGAGE. THAT'S A WEAPON. NOBODY HAS A SAMPLE SIZE ON HIM YET.",
    author: "CADE PUNDIT DESK",
    role: "NEW ARRIVAL FILE",
    playerSlug: "guru",
    playerDisplayName: "GURU",
  },
  {
    variantId: "pundit-guru-ritual",
    text: "GURU SIPS WATER AFTER EVERY GOAL HE SCORES. IT'S NOT A QUIRK — IT'S COOLDOWN DISCIPLINE.",
    author: "ANALYST CORNER",
    role: "PERSONALITY FILE",
    playerSlug: "guru",
    playerDisplayName: "GURU",
  },
  {
    variantId: "pundit-wolevation-pause",
    text: "WOLEVATION PAUSES MATCHES AT HIGH-PRESSURE MOMENTS. RHYTHM-BREAKING IS A TACTIC, NOT AN ACCIDENT.",
    author: "ANALYST CORNER",
    role: "TACTICAL READ",
    playerSlug: "wolevation",
    playerDisplayName: "WOLEVATION",
  },
  {
    variantId: "pundit-faruk-draw-parallel",
    text: "FARUK DREW ONLY ONE MATCH LAST SEASON. ONE. HE'S ALREADY DRAWN ONE THIS SEASON — TO A NEWCOMER, GURU.",
    author: "CADE PUNDIT DESK",
    role: "ELITE WATCH",
    playerSlug: "faruk",
    playerDisplayName: "FARUK",
  },
];

/**
 * Paired punditry cards — combine LAST_SEASON_STANDINGS with current
 * standings rows. Each card cites a specific figure from BOTH seasons.
 */
function pairedPunditryVariants(
  current: Map<string, CurrentPlayerStat>,
): PunditryVariant[] {
  const out: PunditryVariant[] = [];

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

    if (last.slug === "faruk") {
      out.push({
        variantId: "pundit-paired-faruk-losses",
        text:
          now.losses === 0
            ? `FARUK NEVER LOST A MATCH LAST SEASON. ${now.played} GAMES IN HE'S STILL UNBEATEN. THE PATTERN HOLDS.`
            : `FARUK NEVER LOST A MATCH LAST SEASON. HE HAS ALREADY DROPPED ${now.losses} ${now.losses === 1 ? "GAME" : "GAMES"} THIS YEAR. THE INVINCIBLE IS HUMAN.`,
        author: "CADE PUNDIT DESK",
        role: "ELITE WATCH",
        player: playerRef,
      });
    }

    if (last.slug === "killer_freak") {
      out.push({
        variantId: "pundit-paired-killer-freak-losses",
        text: `KILLER FREAK TOOK ONE LOSS ALL OF LAST SEASON. HE'S ON ${now.losses} ALREADY THIS YEAR AFTER ${now.played} MATCHES.`,
        author: "ANALYST CORNER",
        role: "ELITE WATCH",
        player: playerRef,
      });
    }

    if (last.slug === "baji_jnr") {
      out.push({
        variantId: "pundit-paired-baji-gd",
        text: `BAJI JR CLOSED LAST SEASON AT ${fmtSigned(last.goalDiff)} GD. ${now.played} INTO THIS SEASON HE'S AT ${fmtSigned(now.goalDiff)}. THE TRAJECTORY IS THE STORY.`,
        author: "CADE PUNDIT DESK",
        role: "ELITE WATCH",
        player: playerRef,
      });
    }

    if (last.slug === "adefola") {
      out.push({
        variantId: "pundit-paired-adefola-draws",
        text:
          now.draws === 0
            ? `ADEFOLA NEVER LEARNED HOW TO DRAW LAST SEASON. ZERO STALEMATES IN 15. ${now.played} GAMES IN, STILL ZERO. THAT'S A SIGNATURE.`
            : `ADEFOLA WENT THE ENTIRE LAST SEASON WITHOUT A DRAW. HE BROKE THAT THIS YEAR — ${now.draws} ALREADY ON THE BOARD.`,
        author: "ANALYST CORNER",
        role: "ELITE WATCH",
        player: playerRef,
      });
    }

    if (last.slug === "mitch") {
      out.push({
        variantId: "pundit-paired-mitch-pts",
        text: `MITCH MANAGED ${last.points} POINTS LAST SEASON. ${now.played} INTO THIS ONE HE'S ON ${now.points}. WATCH HIM CLOSELY.`,
        author: "CADE PUNDIT DESK",
        role: "ELITE WATCH",
        player: playerRef,
      });
    }

    if (last.slug === "mr_oga") {
      out.push({
        variantId: "pundit-paired-mr-oga-draws",
        text: `MR OGA LED ALL RETURNERS WITH 4 DRAWS LAST SEASON. ${now.played} IN THIS ONE HE'S DRAWN ${now.draws}. THE PATTERN IS HOLDING.`,
        author: "ANALYST CORNER",
        role: "ELITE WATCH",
        player: playerRef,
      });
    }

    if (last.slug === "anife") {
      out.push({
        variantId: "pundit-paired-anife-gd",
        text: `ANIFE FINISHED LAST SEASON AT ${fmtSigned(last.goalDiff)} GD — THE WORST OF ANY RETURNER. HE'S AT ${fmtSigned(now.goalDiff)} ${now.played} IN. THE REBUILD IS LIVE.`,
        author: "ANALYST CORNER",
        role: "REBUILD WATCH",
        player: playerRef,
      });
    }
  }

  return out;
}

export function buildPunditryVariants(
  stats: CoverUpStatsPayload,
  currentStandings: Map<string, CurrentPlayerStat> = new Map(),
): PunditryVariant[] {
  const out: PunditryVariant[] = [];

  // 1. Curated quotes (verified-fact-anchored).
  for (const q of PUNDIT_QUOTES) {
    out.push({
      variantId: q.variantId,
      text: q.text,
      author: q.author,
      role: q.role,
      player: q.playerSlug && q.playerDisplayName
        ? {
            playerId: "",
            displayName: q.playerDisplayName,
            slug: q.playerSlug,
            photoUrl: null,
            orgName: null,
            orgLogoUrl: null,
          } as CoverUpPlayer
        : null,
    });
  }

  // 2. Paired cross-season comparisons (last + current).
  out.push(...pairedPunditryVariants(currentStandings));

  // 3. Auto-headline from cover_up_stats as one option among many.
  if (stats.punditryQuote) {
    out.push({
      variantId: "pundit-auto-current-headline",
      text: stats.punditryQuote.text,
      author: stats.punditryQuote.author,
      role: stats.punditryQuote.role,
      player: stats.punditryQuote.player,
    });
  }

  return out.slice(0, 30);
}
