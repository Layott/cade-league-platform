/**
 * Auto-derived single-line stat blurbs for overlay 22-power-rankings.
 *
 * Each rank slot's `.blurb` element is populated from the player's
 * leaderboard row stats so the line ALWAYS reflects what's actually
 * true right now — when rank 1 swaps mid-stream from BAJI JNR to FARUK,
 * the blurb at slot 1 immediately switches to FARUK's standout stat
 * instead of staying pinned on the previous occupant's storyline.
 *
 * Rule cascade (first match wins). Each branch returns a hyped ≤ 90 char
 * line with one verb-y storyline and at least one numeric stat. Variants
 * per branch — picked by `rank` modulo variant count — so no two slots
 * on screen ever read identically even when they hit the same cascade
 * rule. Deterministic per (rank, p, w, d, l, gf, ga, gd, pts) tuple.
 *
 * Companion to `apps/web/src/server/overlays/copy/ai_regenerate.ts` —
 * the AI-regen path overwrites `overlay_text_elements.content`, the
 * narrative path computes per-refresh and rides the leaderboard payload.
 * Overlay HTML's `update()` prefers `r.narrative` over the static seed.
 */

export type LeaderboardStatInput = {
  rank: number;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
};

function gfPerMatch(s: LeaderboardStatInput): number {
  return s.p > 0 ? s.gf / s.p : 0;
}
function gaPerMatch(s: LeaderboardStatInput): number {
  return s.p > 0 ? s.ga / s.p : 0;
}
function fmtSigned(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
function recordLabel(s: LeaderboardStatInput): string {
  return `${s.w}W-${s.d}D-${s.l}L`;
}
function pick(variants: string[], rank: number): string {
  if (variants.length === 0) return "";
  return variants[(Math.max(1, rank) - 1) % variants.length];
}

export function buildPowerRankingNarrative(s: LeaderboardStatInput): string {
  const gpm = gfPerMatch(s).toFixed(1);
  const gapm = gaPerMatch(s).toFixed(1);
  const rec = recordLabel(s);
  const gd = fmtSigned(s.gd);

  // No games played yet
  if (s.p === 0) {
    if (s.rank === 1) {
      return pick(
        [
          `Tipped to set the pace this season.`,
          `Pre-season favourite. Time to deliver.`,
          `Crown on loan — defending starts now.`,
        ],
        s.rank,
      );
    }
    return pick(
      [
        `Awaiting opening fixture · MD-1 looms.`,
        `Pen is loaded · season about to ignite.`,
        `Quiet so far · explosion incoming.`,
      ],
      s.rank,
    );
  }

  // Perfect record
  if (s.l === 0 && s.d === 0 && s.w >= 3) {
    return pick(
      [
        `Untouchable · ${s.w}-0-0, GD ${gd}, nothing in sight.`,
        `Perfect run · ${s.w} from ${s.w}, GD ${gd}.`,
        `${s.w} games. Zero blemishes. GD ${gd}.`,
        `Cleansheet machine · ${s.w}-0-0, scoring ${s.gf}.`,
        `Flawless · ${s.w} wins on the bounce, GD ${gd}.`,
      ],
      s.rank,
    );
  }

  // Unbeaten with draws
  if (s.l === 0 && s.p >= 3) {
    return pick(
      [
        `Refusing to lose · ${rec}, GD ${gd}.`,
        `${s.p} games. 0 Ls. GD ${gd}.`,
        `Iron run · unbeaten through ${s.p}, GD ${gd}.`,
        `Brick wall season · ${rec}, ${s.pts} pts.`,
        `Stays standing · ${s.p} games, 0 losses.`,
      ],
      s.rank,
    );
  }

  // Goal flood — top-3 attack
  if (gfPerMatch(s) >= 3.0 && s.p >= 2 && s.rank <= 3) {
    return pick(
      [
        `Scoring at will · ${s.gf} goals in ${s.p} (${gpm}/match).`,
        `Goalscorer in chief · ${s.gf} bagged across ${s.p}.`,
        `Defences in shambles · ${s.gf} put past them.`,
        `Goal blitz · ${s.gf} netted, ${gpm} per game.`,
        `Foot off the gas, never · ${s.gf} in ${s.p}.`,
      ],
      s.rank,
    );
  }

  // Stingy defence
  if (gaPerMatch(s) <= 0.8 && s.p >= 2 && s.rank <= 6) {
    return pick(
      [
        `Concrete back · ${s.ga} let in across ${s.p}.`,
        `Lockdown mode · only ${s.ga} conceded, GD ${gd}.`,
        `Wall going up · ${gapm}/match conceded.`,
        `Defence locked tight · ${s.ga} past them in ${s.p}.`,
        `Vault sealed · ${s.ga} conceded, GD ${gd}.`,
      ],
      s.rank,
    );
  }

  // Hot streak in medal places
  if (s.w >= 4 && s.l <= 1 && s.rank <= 3) {
    return pick(
      [
        `Steamrolling · ${rec}, ${s.pts} pts banked.`,
        `On the warpath · ${s.w} wins, only ${s.l} L.`,
        `Conveyor of wins · ${s.w} from ${s.p}.`,
        `Form is electric · ${rec}, ${s.pts} pts.`,
        `Hot run · ${s.w}W from ${s.p}, ${s.pts} pts.`,
      ],
      s.rank,
    );
  }

  // Goal-difference giant despite mid rank
  if (s.gd >= 10 && s.rank >= 2) {
    return pick(
      [
        `Scoreline punisher · GD ${gd} despite the slip.`,
        `Goal-swing monster · GD ${gd}.`,
        `Margins savage · GD ${gd}, ranked ${s.rank}.`,
        `Hammers when it counts · GD ${gd}.`,
      ],
      s.rank,
    );
  }

  // Mid-pack with wins > losses
  if (s.rank >= 3 && s.rank <= 8 && s.w > s.l) {
    return pick(
      [
        `Charging up the board · ${rec}, ${s.pts} pts.`,
        `Stalking the leaders · ${s.pts} pts and counting.`,
        `Quiet surge · ${s.w}W from ${s.p}, ${s.pts} pts.`,
        `Knocking on the door · ${rec}, ${s.pts} pts.`,
        `Trending up · ${s.pts} pts, ${gd} swing.`,
        `Pressing the chasers · ${rec}, ${s.pts} pts.`,
        `Engine warming · ${s.w} wins, ${s.pts} pts.`,
      ],
      s.rank,
    );
  }

  // Bad spell — multiple losses, few wins
  if (s.l >= 3 && s.w <= 1) {
    return pick(
      [
        `Searching for the spark · ${rec}.`,
        `Stuck in low gear · ${s.l} losses already.`,
        `Off the boil · ${rec}, GD ${gd}.`,
        `Form has slipped · ${rec}.`,
      ],
      s.rank,
    );
  }

  // Negative GD trending wrong way
  if (s.gd <= -5) {
    return pick(
      [
        `GD ${gd}. Time to swing back hard.`,
        `Bleeding goals · GD ${gd} after ${s.p}.`,
        `Damage piling up · GD ${gd}, response needed.`,
        `Conceding too freely · GD ${gd}.`,
      ],
      s.rank,
    );
  }

  // Stalemate king
  if (s.d >= 3 && s.w <= 2 && s.l <= 2) {
    return pick(
      [
        `Draw specialist · ${s.d} stalemates, ${s.pts} grinding pts.`,
        `King of the deadlock · ${s.d} draws banked.`,
        `Won't crack, won't crush · ${s.d}D, ${s.pts} pts.`,
        `Stalemate factory · ${s.d} draws from ${s.p}.`,
      ],
      s.rank,
    );
  }

  // Top-of-table fallback
  if (s.rank === 1) {
    return pick(
      [
        `Pacesetter · ${rec}, ${s.pts} pts, GD ${gd}.`,
        `Top of the pile · ${rec}, ${s.pts} pts.`,
        `Setting the standard · ${s.pts} pts and ${gd} GD.`,
        `Throne occupied · ${rec}, ${s.pts} pts.`,
      ],
      s.rank,
    );
  }

  // Generic fallback — pick by rank
  return pick(
    [
      `${rec} · ${s.pts} pts, GD ${gd}.`,
      `${s.pts} on the board · ${s.gf} scored, ${s.ga} let in.`,
      `Holding station · ${rec}, ${s.pts} pts.`,
      `${rec} so far · ${s.pts} pts, ${gd} GD.`,
      `Grinding through · ${s.pts} pts banked.`,
    ],
    s.rank,
  );
}
