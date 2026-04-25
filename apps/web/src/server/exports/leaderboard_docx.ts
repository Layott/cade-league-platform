import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  HeadingLevel,
  AlignmentType,
  WidthType,
} from "docx";

/**
 * Plan 51 — leaderboard DOCX export.
 *
 * Same shape as the XLSX leaderboard but renders as a Word document. The
 * DOCX is what referees + organisers paste into briefing memos. Mirrors
 * the XLSX read path so both exports stay in lock-step on data shape.
 */

type StandingsRow = {
  player_id: string;
  matches_played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  player: {
    gamer_tag: string | null;
    users: { display_name: string | null } | null;
  } | null;
};

type MatchResultRow = {
  match_id: string;
  home_score: number;
  away_score: number;
  created_at: string | null;
  match: {
    home_player_id: string;
    away_player_id: string;
    season_id: string;
  } | null;
};

async function readStandings(
  sb: SupabaseClient,
  seasonId: number | string,
): Promise<StandingsRow[]> {
  const { data, error } = await sb
    .from("standings")
    .select(
      `player_id, matches_played, wins, draws, losses,
       goals_for, goals_against, goal_difference, points,
       player:player_id ( gamer_tag, users:users!players_user_id_fkey ( display_name ) )`,
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("points", { ascending: false })
    .order("goal_difference", { ascending: false })
    .order("goals_for", { ascending: false });
  if (error) throw new Error(`leaderboard standings read: ${error.message}`);
  return (data ?? []) as unknown as StandingsRow[];
}

async function readRecentResults(
  sb: SupabaseClient,
  seasonId: number | string,
): Promise<MatchResultRow[]> {
  const { data, error } = await sb
    .from("match_results")
    .select(
      `match_id, home_score, away_score, created_at,
       match:match_id ( home_player_id, away_player_id, season_id )`,
    )
    .is("deleted_at", null)
    .not("confirmed_at", "is", null);
  if (error) {
    console.warn(`leaderboard form read failed: ${error.message}`);
    return [];
  }
  // Inline season filter — Supabase's `.eq("match.season_id", ...)` shorthand
  // is unreliable on joined columns (silently no-ops on cloud).
  return ((data ?? []) as unknown as MatchResultRow[]).filter(
    (r) => r.match?.season_id === seasonId,
  );
}

function letterFor(score: number, opponent: number): "W" | "D" | "L" {
  if (score > opponent) return "W";
  if (score < opponent) return "L";
  return "D";
}

export function buildFormMap(
  results: MatchResultRow[],
): Map<string, string> {
  const sorted = [...results].sort((a, b) => {
    const at = a.created_at ?? "";
    const bt = b.created_at ?? "";
    return at.localeCompare(bt);
  });
  const perPlayer = new Map<string, string[]>();
  for (const r of sorted) {
    const m = r.match;
    if (!m) continue;
    push(perPlayer, m.home_player_id, letterFor(r.home_score, r.away_score));
    push(perPlayer, m.away_player_id, letterFor(r.away_score, r.home_score));
  }
  const out = new Map<string, string>();
  for (const [pid, list] of perPlayer.entries()) {
    out.set(pid, list.slice(-5).join(""));
  }
  return out;
}

function push(m: Map<string, string[]>, k: string, v: string): void {
  const arr = m.get(k) ?? [];
  arr.push(v);
  m.set(k, arr);
}

const TABLE_HEADERS = [
  "Pos",
  "Player",
  "P",
  "W",
  "D",
  "L",
  "GF",
  "GA",
  "GD",
  "Pts",
  "Form",
] as const;

function txt(value: string | number, bold = false): TableCell {
  return new TableCell({
    width: { size: 9, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [new TextRun({ text: String(value), bold })],
      }),
    ],
  });
}

export function buildDocument(
  standings: StandingsRow[],
  formMap: Map<string, string>,
  capturedAt: Date = new Date(),
): Document {
  const headerRow = new TableRow({
    tableHeader: true,
    children: TABLE_HEADERS.map((h) => txt(h, true)),
  });
  const dataRows = standings.map((s, idx) => {
    const name =
      s.player?.users?.display_name ?? s.player?.gamer_tag ?? "(unknown)";
    return new TableRow({
      children: [
        txt(idx + 1),
        txt(name),
        txt(s.matches_played),
        txt(s.wins),
        txt(s.draws),
        txt(s.losses),
        txt(s.goals_for),
        txt(s.goals_against),
        txt(s.goal_difference),
        txt(s.points, true),
        txt(formMap.get(s.player_id) ?? ""),
      ],
    });
  });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });

  const title = new Paragraph({
    text: "CADE Esports League — Leaderboard",
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
  });
  const stamp = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: `Last updated ${capturedAt.toISOString()}`,
        italics: true,
      }),
    ],
  });

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: "Inter", size: 20 },
        },
      },
    },
    sections: [
      {
        properties: {},
        children: [title, stamp, new Paragraph({ text: "" }), table],
      },
    ],
  });
}

/**
 * Generate the leaderboard DOCX. Returns a Buffer holding the .docx bytes.
 */
export async function generateLeaderboardDOCX(
  seasonId: number | string,
  supabase: SupabaseClient,
): Promise<Buffer> {
  const [standings, results] = await Promise.all([
    readStandings(supabase, seasonId),
    readRecentResults(supabase, seasonId),
  ]);
  const formMap = buildFormMap(results);
  const doc = buildDocument(standings, formMap);
  return Packer.toBuffer(doc);
}
