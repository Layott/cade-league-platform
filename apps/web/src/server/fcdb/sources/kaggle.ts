/**
 * Plan 24 — Kaggle CLI source adapter (dev-only).
 *
 * Shells out to the `kaggle` CLI to download the canonical
 * flynn28/eafc26-player-database dataset, then parses the resulting CSV
 * into NormalizedFCRow[] so the orchestrator can upsert uniformly across
 * sources.
 *
 * Vercel serverless can't `pip install kaggle` or persist a writable
 * working directory, so this path is effectively dev-only. On production
 * cron runs we skip fast if:
 *   - KAGGLE_API_TOKEN / KAGGLE_KEY env var is not set, OR
 *   - the `kaggle` CLI isn't on PATH.
 *
 * That keeps the production cron green (no noise from "kaggle unavailable"
 * failures) while still letting a self-hosted runner / local dev box pick
 * this path up automatically when the token + CLI are present.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { slugify } from "../slug";
import type { NormalizedFCRow, SourceResult } from "./types";

const DATASET_SLUG = "flynn28/eafc26-player-database";
const DATASET_TAG = "https://www.kaggle.com/datasets/flynn28/eafc26-player-database";

export type KaggleFetchOptions = {
  /** For tests: override the child_process exec impl. */
  runImpl?: (
    cmd: string,
    args: string[],
    cwd: string,
  ) => Promise<{ stdout: string; stderr: string; code: number }>;
  /** For tests: pretend the CLI is/isn't installed. */
  whichImpl?: (cmd: string) => Promise<boolean>;
  /** For tests: override the extraction dir. Defaults to a tempdir. */
  workDir?: string;
};

function hasKaggleToken(): boolean {
  // Official Kaggle CLI honors KAGGLE_USERNAME + KAGGLE_KEY OR a
  // ~/.kaggle/kaggle.json file. We accept either KAGGLE_API_TOKEN (which
  // some CI systems prefer) or KAGGLE_KEY.
  const hasEnv = !!(
    process.env.KAGGLE_KEY ||
    process.env.KAGGLE_API_TOKEN ||
    process.env.KAGGLE_USERNAME
  );
  return hasEnv;
}

async function defaultWhich(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn(process.platform === "win32" ? "where" : "which", [cmd], {
      stdio: "ignore",
      shell: false,
    });
    probe.on("error", () => resolve(false));
    probe.on("exit", (code) => resolve(code === 0));
  });
}

async function defaultRun(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      resolve({ stdout, stderr: stderr + String(err), code: -1 });
    });
    child.on("exit", (code) => {
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

/**
 * Minimal, best-effort CSV parser for the flynn28 schema. Only pulls the
 * columns we need for a refresh; ignores unknown columns. Robust against
 * trailing commas in quoted fields; not a full RFC4180 parser — that's
 * overkill for a single upstream schema.
 */
export function parseKaggleCsv(content: string): NormalizedFCRow[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const iId = idx("id");
  const iName = idx("name");
  const iOverall = idx("overall");
  const iPos = idx("position");
  const iClub = idx("club_name");
  const iLeague = idx("league_name");
  const iNation = idx("nationality_name");
  const iPrice = idx("value_eur");
  const iItem = idx("item_type");
  const iAltPos = idx("alt_positions");

  const rows: NormalizedFCRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const name = (iName >= 0 ? cells[iName] : "").trim();
    const ratingRaw = iOverall >= 0 ? parseInt(cells[iOverall] ?? "", 10) : NaN;
    if (!name || !Number.isFinite(ratingRaw)) continue;
    const rating = Math.max(1, Math.min(99, ratingRaw));

    const id = iId >= 0 ? String(cells[iId] ?? "").trim() : "";
    if (!id) continue;

    const position = (iPos >= 0 ? cells[iPos] : "ST").trim().toUpperCase().slice(0, 8);
    const altRaw = iAltPos >= 0 ? cells[iAltPos] : "";
    const altPositions = altRaw
      ? altRaw
          .split(/[,;]+/)
          .map((p) => p.trim().toUpperCase())
          .filter((p) => p && p !== position)
      : null;

    const price = iPrice >= 0 ? parseInt(cells[iPrice] ?? "", 10) : NaN;

    rows.push({
      source_dataset: DATASET_TAG,
      source_row_id: id,
      name,
      slug: slugify(name),
      rating,
      position,
      alt_positions: altPositions && altPositions.length ? altPositions : null,
      club: iClub >= 0 ? emptyToNull(cells[iClub]) : null,
      league: iLeague >= 0 ? emptyToNull(cells[iLeague]) : null,
      nation: iNation >= 0 ? emptyToNull(cells[iNation]) : null,
      item_type: iItem >= 0 ? normalizeItem(cells[iItem]) : "normal",
      value_coins_estimate: Number.isFinite(price) ? price : null,
      attributes: {},
    });
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') {
        inQ = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ",") {
        cells.push(cur);
        cur = "";
      } else if (c === '"') {
        inQ = true;
      } else {
        cur += c;
      }
    }
  }
  cells.push(cur);
  return cells;
}

function emptyToNull(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  return t.length ? t : null;
}

function normalizeItem(raw: string | undefined): string {
  if (!raw) return "normal";
  const s = raw.trim().toLowerCase();
  if (s.includes("icon")) return "icon";
  if (s.includes("hero")) return "hero";
  if (s.includes("totw")) return "totw";
  if (s.includes("evo")) return "evolution";
  if (s.includes("special")) return "special";
  return "normal";
}

/**
 * Top-level entry. Skip fast when prereqs are missing; only actually shell
 * out when both the token + CLI are present.
 */
export async function tryKaggleRefresh(
  opts: KaggleFetchOptions = {},
): Promise<SourceResult> {
  if (!hasKaggleToken()) {
    return {
      skipped: true,
      source: "kaggle",
      reason: "KAGGLE_API_TOKEN / KAGGLE_KEY not set",
    };
  }

  const whichImpl = opts.whichImpl ?? defaultWhich;
  const kaggleOnPath = await whichImpl("kaggle");
  if (!kaggleOnPath) {
    return {
      skipped: true,
      source: "kaggle",
      reason: "kaggle CLI not on PATH",
    };
  }

  const workDir =
    opts.workDir ?? path.join(tmpdir(), `fc26-kaggle-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  const runImpl = opts.runImpl ?? defaultRun;
  const result = await runImpl(
    "kaggle",
    ["datasets", "download", "-d", DATASET_SLUG, "-p", workDir, "--unzip"],
    workDir,
  );
  if (result.code !== 0) {
    return {
      skipped: true,
      source: "kaggle",
      reason: `kaggle CLI exited ${result.code}: ${result.stderr.slice(0, 200)}`,
    };
  }

  // Find the CSV the CLI dropped (flynn28 ships one canonical CSV).
  let csvPath: string | null = null;
  const entries = await fs.readdir(workDir);
  for (const entry of entries) {
    if (entry.toLowerCase().endsWith(".csv")) {
      csvPath = path.join(workDir, entry);
      break;
    }
  }
  if (!csvPath) {
    return {
      skipped: true,
      source: "kaggle",
      reason: "kaggle CLI succeeded but no CSV found",
    };
  }

  const content = await fs.readFile(csvPath, "utf8");
  const rows = parseKaggleCsv(content);
  return { source: "kaggle", rows };
}
