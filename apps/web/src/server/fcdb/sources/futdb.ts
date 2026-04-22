/**
 * Plan 24 — futdb.co source adapter.
 *
 * Fetches pages from https://futdb.co/api/players?page=N using the free
 * X-AUTH-TOKEN header. Rate-limited to 1 req/sec (well under the free
 * tier's 100 req/day). A single incremental refresh only touches the top
 * few pages nightly — enough to keep recently-added cards + the "most
 * changed" section current without burning the day's quota.
 *
 * Shape of the upstream response (minimum we rely on):
 *   {
 *     "items": [
 *       {
 *         "id": 1234,
 *         "commonName": "L. Messi" | null,
 *         "firstName": "Lionel",
 *         "lastName": "Messi",
 *         "rating": 94,
 *         "position": "CAM",
 *         "playerPositions": ["CAM","RW","CF"],
 *         "club": { "name": "Inter Miami" } | number,  // id-only on some rows
 *         "league": { "name": "MLS" } | number,
 *         "nation": { "name": "Argentina" } | number,
 *         "rarity": { "name": "Gold - Rare" } | number,
 *         "price": 27500 | null,
 *         "attributes": {
 *           "pac": 80, "sho": 89, "pas": 91, "dri": 94, "def": 33, "phy": 63
 *         }
 *       }
 *     ],
 *     "pagination": { "currentPage": 1, "totalPages": 216 }
 *   }
 *
 * We map to `NormalizedFCRow` so refresh.ts can upsert uniformly across
 * sources.
 */

import { slugify } from "../slug";
import type { NormalizedFCRow, SourceResult } from "./types";

const FUTDB_BASE = "https://futdb.co/api/players";
const DATASET_TAG = "futdb.co";

// Free-tier quota is 100 req/day. A nightly refresh of the top 3 pages at
// 100 cards/page gives us 300 fresh rows with 3 quota units. The retry
// budget caps total requests at ~10 even under pathological error loops.
const DEFAULT_PAGES = 3;
const MAX_PAGES = 5;
const RATE_LIMIT_MS = 1_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2_000;

export type FutdbFetchOptions = {
  /** Override total pages fetched per run. Default 3 (300 cards). */
  pages?: number;
  /** For tests: stubbed fetch. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** For tests: skip the sleep between requests. */
  sleepImpl?: (ms: number) => Promise<void>;
};

type FutdbClub = number | { name?: string | null } | null;
type FutdbLeague = number | { name?: string | null } | null;
type FutdbNation = number | { name?: string | null } | null;
type FutdbRarity = number | { name?: string | null } | null;
type FutdbAttributes = Record<string, number | null | undefined> | null;

type FutdbItem = {
  id?: number | string;
  commonName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  rating?: number | null;
  position?: string | null;
  playerPositions?: string[] | null;
  club?: FutdbClub;
  league?: FutdbLeague;
  nation?: FutdbNation;
  rarity?: FutdbRarity;
  price?: number | null;
  attributes?: FutdbAttributes;
};

type FutdbPage = {
  items?: FutdbItem[];
  pagination?: { currentPage?: number; totalPages?: number };
};

function resolveName(item: FutdbItem): string {
  const direct = (item.commonName || item.name || "").trim();
  if (direct) return direct;
  const first = (item.firstName || "").trim();
  const last = (item.lastName || "").trim();
  return `${first} ${last}`.trim();
}

function resolveNamedField(
  v: FutdbClub | FutdbLeague | FutdbNation | FutdbRarity,
): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return null; // id-only reference; name unavailable
  if (typeof v === "object" && typeof v.name === "string" && v.name.trim()) {
    return v.name.trim();
  }
  return null;
}

function normalizeItemType(rarityName: string | null): string {
  if (!rarityName) return "normal";
  const s = rarityName.toLowerCase();
  if (s.includes("icon")) return "icon";
  if (s.includes("hero")) return "hero";
  if (s.includes("totw") || s.includes("team of the week")) return "totw";
  if (s.includes("evo")) return "evolution";
  if (s.includes("rare") || s.includes("gold") || s.includes("silver") || s.includes("bronze")) {
    return "normal";
  }
  return "special";
}

function packAttributes(attrs: FutdbAttributes): Record<string, number> {
  if (!attrs) return {};
  // futdb uses short keys: pac / sho / pas / dri / def / phy. Expand so the
  // local catalogue uses the same shape as the Kaggle importer.
  const aliases: Record<string, string> = {
    pac: "pace",
    sho: "shooting",
    pas: "passing",
    dri: "dribbling",
    def: "defending",
    phy: "physical",
  };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const key = aliases[k] ?? k;
    out[key] = Math.round(v);
  }
  return out;
}

export function normalizeFutdbItem(item: FutdbItem): NormalizedFCRow | null {
  const name = resolveName(item);
  const rating = typeof item.rating === "number" ? Math.round(item.rating) : null;
  if (!name || rating === null || rating < 1 || rating > 99) return null;
  const sourceRowId = String(item.id ?? "").trim();
  if (!sourceRowId) return null;

  const position = (item.position || "ST").trim().toUpperCase().slice(0, 8);
  const altRaw = Array.isArray(item.playerPositions) ? item.playerPositions : null;
  const altPositions =
    altRaw && altRaw.length
      ? altRaw.map((p) => String(p).trim().toUpperCase()).filter((p) => p && p !== position)
      : null;

  const rarity = resolveNamedField(item.rarity ?? null);
  const price =
    typeof item.price === "number" && Number.isFinite(item.price) && item.price >= 0
      ? Math.round(item.price)
      : null;

  return {
    source_dataset: DATASET_TAG,
    source_row_id: sourceRowId,
    name,
    slug: slugify(name),
    rating,
    position,
    alt_positions: altPositions && altPositions.length ? altPositions : null,
    club: resolveNamedField(item.club ?? null),
    league: resolveNamedField(item.league ?? null),
    nation: resolveNamedField(item.nation ?? null),
    item_type: normalizeItemType(rarity),
    value_coins_estimate: price,
    attributes: packAttributes(item.attributes ?? null),
  };
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch a single page. Handles 429 (rate-limited) with bounded exponential
 * backoff; any other non-2xx throws with a descriptive message that the
 * orchestrator catches + logs.
 */
export async function fetchFutdbPage(
  page: number,
  apiKey: string,
  opts: { fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void> } = {},
): Promise<FutdbPage> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleepImpl = opts.sleepImpl ?? defaultSleep;
  const url = `${FUTDB_BASE}?page=${page}`;

  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    const resp = await fetchImpl(url, {
      method: "GET",
      headers: {
        "X-AUTH-TOKEN": apiKey,
        Accept: "application/json",
      },
    });
    if (resp.status === 429) {
      attempt += 1;
      if (attempt > MAX_RETRIES) {
        throw new Error(`futdb page ${page}: rate limited after ${MAX_RETRIES} retries`);
      }
      const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await sleepImpl(backoff);
      continue;
    }
    if (!resp.ok) {
      throw new Error(`futdb page ${page}: HTTP ${resp.status}`);
    }
    const json = (await resp.json()) as FutdbPage;
    return json;
  }
  throw new Error(`futdb page ${page}: exhausted retries`);
}

/**
 * Top-level entry. Walks 1..DEFAULT_PAGES (or opts.pages), rate-limited at
 * 1 req/s, accumulates rows. If FUTDB_API_KEY is not set, returns a
 * skipped result without hitting the network.
 */
export async function fetchFutdb(
  opts: FutdbFetchOptions = {},
): Promise<SourceResult> {
  const apiKey = process.env.FUTDB_API_KEY;
  if (!apiKey) {
    return {
      skipped: true,
      source: "futdb",
      reason: "FUTDB_API_KEY not set",
    };
  }

  const totalPages = Math.min(opts.pages ?? DEFAULT_PAGES, MAX_PAGES);
  const sleepImpl = opts.sleepImpl ?? defaultSleep;
  const rows: NormalizedFCRow[] = [];

  for (let page = 1; page <= totalPages; page += 1) {
    if (page > 1) {
      // Enforce 1 req/sec minimum spacing.
      await sleepImpl(RATE_LIMIT_MS);
    }
    const json = await fetchFutdbPage(page, apiKey, {
      fetchImpl: opts.fetchImpl,
      sleepImpl: opts.sleepImpl,
    });
    const items = Array.isArray(json.items) ? json.items : [];
    for (const item of items) {
      const normalized = normalizeFutdbItem(item);
      if (normalized) rows.push(normalized);
    }
    // If server told us we already ran past the end, stop early.
    if (
      typeof json.pagination?.totalPages === "number" &&
      json.pagination.totalPages > 0 &&
      page >= json.pagination.totalPages
    ) {
      break;
    }
  }

  return { source: "futdb", rows };
}
