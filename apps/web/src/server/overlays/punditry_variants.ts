import type {
  CoverUpStatsPayload,
  CoverUpPlayer,
  PunditryQuote,
} from "./cover_up_stats";

/**
 * Punditry quote variant catalog for overlay 28-punditry.
 *
 * Returns a list of broadcast-pundit quote cards the producer can
 * fire. Each variant carries the same `PunditryQuote` shape the
 * overlay's `update()` already consumes:
 *   { text, author, role, player }
 *
 * Same authoring rule as did-you-know:
 *   • Curated entries (PUNDIT_QUOTES) — broadcaster-voice lines. Add
 *     only when you have a real quote OR the producer has approved
 *     the line.
 *   • Computed branch — derives quotes from stats data with explicit
 *     real numbers. No invented opinions; if the line cites a stat,
 *     the stat must come from the season payload.
 */

export type PunditryVariant = PunditryQuote & {
  variantId: string;
};

/**
 * Hand-curated pundit quotes. Each entry is a stable broadcast line
 * — neutral analysis, season-agnostic where possible. Add new lines
 * by appending to the array.
 *
 * Attribution authors are fictional broadcast-desk handles
 * (CADE PUNDIT DESK, ANALYST CORNER, etc.) — safe to attribute to.
 * Add real-pundit attributions only with explicit producer sign-off.
 */
const PUNDIT_QUOTES: Array<{
  variantId: string;
  text: string;
  author: string;
  role: string;
  playerSlug?: string;
  playerDisplayName?: string;
}> = [
  {
    variantId: "pundit-elite-blooded-vs-new",
    text: "SEVEN OF THESE PLAYERS HAVE TASTED ELITE BEFORE. SIX HAVEN'T. THIS SEASON IS DEFINED BY THAT GAP.",
    author: "CADE PUNDIT DESK",
    role: "SEASON OPENING",
  },
  {
    variantId: "pundit-faruk-target",
    text: "FARUK FINISHED LAST SEASON UNBEATEN. EVERY OPPONENT NOW PLAYS HIM WITH A TARGET ON THEIR JERSEY.",
    author: "ANALYST CORNER",
    role: "ELITE WATCH",
    playerSlug: "faruk",
    playerDisplayName: "FARUK",
  },
  {
    variantId: "pundit-guru-arrival",
    text: "GURU ARRIVES WITH NO ELITE BAGGAGE. THAT'S A WEAPON. NOBODY KNOWS HIS PATTERNS YET.",
    author: "CADE PUNDIT DESK",
    role: "NEW ARRIVAL FILE",
    playerSlug: "guru",
    playerDisplayName: "GURU",
  },
  {
    variantId: "pundit-wolevation-rhythm",
    text: "WOLEVATION CONTROLS TEMPO BY DISRUPTING IT. PAUSE PLAY IS NOT A QUIRK — IT'S A TACTIC.",
    author: "ANALYST CORNER",
    role: "TACTICAL READ",
    playerSlug: "wolevation",
    playerDisplayName: "WOLEVATION",
  },
  {
    variantId: "pundit-baji-jr-second-act",
    text: "BAJI JR FINISHED FOURTH LAST SEASON. THE QUESTION ISN'T WHETHER HE CAN STAY THERE — IT'S WHETHER HE'S CLIMBING.",
    author: "CADE PUNDIT DESK",
    role: "ELITE WATCH",
    playerSlug: "baji_jnr",
    playerDisplayName: "BAJI JNR",
  },
  {
    variantId: "pundit-mr-oga-tactical-clean",
    text: "MR OGA DRAWS GAMES. ALWAYS HAS. IN A LEAGUE THIS THIN ON MARGINS, A STALEMATE CAN BE A WIN.",
    author: "ANALYST CORNER",
    role: "ELITE WATCH",
    playerSlug: "mr_oga",
    playerDisplayName: "MR OGA",
  },
  {
    variantId: "pundit-adefola-zero-draws",
    text: "ADEFOLA HAS NEVER LEARNED HOW TO DRAW. HE EITHER WINS OR LOSES — AND IT MAKES HIM IMPOSSIBLE TO PLAN AROUND.",
    author: "CADE PUNDIT DESK",
    role: "ELITE WATCH",
    playerSlug: "adefola",
    playerDisplayName: "ADEFOLA",
  },
  {
    variantId: "pundit-anife-bounce",
    text: "ANIFE'S COMEBACK FROM A -34 GD CAMPAIGN IS THE STORY EVERYONE IS PRETENDING NOT TO WATCH.",
    author: "ANALYST CORNER",
    role: "REBUILD WATCH",
    playerSlug: "anife",
    playerDisplayName: "ANIFE",
  },
  {
    variantId: "pundit-killer-freak-one-loss",
    text: "KILLER FREAK LOST ONE MATCH ALL OF LAST SEASON. ONE. THAT'S THE BAR.",
    author: "CADE PUNDIT DESK",
    role: "ELITE WATCH",
    playerSlug: "killer_freak",
    playerDisplayName: "KILLER FREAK",
  },
  {
    variantId: "pundit-mid-table-fight",
    text: "MID-TABLE THIS SEASON IS WHERE EVERY MATCH MATTERS. THE TOP TWO ARE ALREADY GAPPED.",
    author: "ANALYST CORNER",
    role: "TABLE READ",
  },
];

export function buildPunditryVariants(
  stats: CoverUpStatsPayload,
): PunditryVariant[] {
  const out: PunditryVariant[] = [];

  // 1. Curated quotes (verified / producer-approved).
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

  // 2. Derived. Take the existing single auto-generated punditryQuote
  //    (computed by cover_up_stats from the current standings) and
  //    surface it as one option among many. Producer can still pick a
  //    curated line over it.
  if (stats.punditryQuote) {
    out.push({
      variantId: "auto-current-headline",
      text: stats.punditryQuote.text,
      author: stats.punditryQuote.author,
      role: stats.punditryQuote.role,
      player: stats.punditryQuote.player,
    });
  }

  return out.slice(0, 24);
}
