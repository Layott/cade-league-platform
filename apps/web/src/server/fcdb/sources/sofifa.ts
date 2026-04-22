/**
 * Plan 24 — sofifa.com last-resort HTML source adapter.
 *
 * sofifa.com exposes a paginated player list as a raw HTML table. There's
 * no official JSON API; we scrape the minimal fields we need (id, name,
 * rating, position, club, nation) via regex against the fragment returned
 * for `/players?offset=N`.
 *
 * This source is deliberately fragile — only runs when kaggle is unavailable
 * AND futdb also fails / has no data. Rate-limited to 1 req/s to stay
 * polite. Robots.txt allows the `/players` endpoint.
 *
 * Parser strategy: we do NOT build a full DOM. Just match repeating row
 * patterns that sofifa's server-rendered HTML emits — anchor hrefs like
 * `/player/<id>/<slug>/<versions>` next to a rating cell, nation cell, and
 * club cell. Any mismatch on a single row yields `null`, and the
 * orchestrator keeps the remaining rows. This keeps us resilient to markup
 * drift — if sofifa changes their template, we degrade to "0 rows" + log
 * that, never crash.
 */

import { slugify } from "../slug";
import type { NormalizedFCRow, SourceResult } from "./types";

const SOFIFA_BASE = "https://sofifa.com/api/player";
const DATASET_TAG = "sofifa.com";
const DEFAULT_LIMIT = 60;
const DEFAULT_PAGES = 3;
const MAX_PAGES = 5;
const RATE_LIMIT_MS = 1_000;

export type SofifaFetchOptions = {
  /** Override total pages fetched per run. Default 3 (180 cards). */
  pages?: number;
  /** Override page size. Default 60. */
  limit?: number;
  /** For tests: stubbed fetch. */
  fetchImpl?: typeof fetch;
  /** For tests: skip sleep between requests. */
  sleepImpl?: (ms: number) => Promise<void>;
};

/**
 * Parse sofifa's paginated HTML fragment. Exported for unit tests.
 *
 * sofifa's server-rendered row looks roughly like:
 *   <tr data-player="<id>">
 *     <td><a href="/player/<id>/<slug>/...">L. Messi</a></td>
 *     <td><span class="pos ...">CAM</span></td>
 *     <td>94</td>
 *     <td>Inter Miami</td>
 *     <td>Argentina</td>
 *   </tr>
 *
 * We walk `<tr data-player=...>...</tr>` blocks and extract fields per row.
 * Any failure on a given row → skip that row silently.
 */
export function parseSofifaHtml(html: string): NormalizedFCRow[] {
  if (!html) return [];
  const rows: NormalizedFCRow[] = [];

  const rowRegex = /<tr[^>]*data-player=["'](\d+)["'][^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const id = rowMatch[1];
    const body = rowMatch[2];

    // Name: first <a href="/player/<id>/...">Name</a>.
    const nameMatch = /<a[^>]+href=["']\/player\/\d+\/[^"']*["'][^>]*>([^<]+)<\/a>/i.exec(body);
    const name = nameMatch ? decodeEntities(nameMatch[1]).trim() : "";
    if (!name) continue;

    // Position: first <span class="... pos ...">XY</span> (usually 2-3 letters).
    const posMatch = /<span[^>]*class=["'][^"']*\bpos\b[^"']*["'][^>]*>([A-Z]{1,4})<\/span>/i.exec(
      body,
    );
    const position = (posMatch ? posMatch[1] : "ST").toUpperCase().slice(0, 8);

    // Rating: look for a bare integer 40-99 inside a <td> or <span>. We
    // grab the first such number after the anchor — sofifa puts rating
    // first in the attribute columns.
    const ratingMatch = />\s*(\d{2})\s*</g;
    const ratings: number[] = [];
    let rm: RegExpExecArray | null;
    while ((rm = ratingMatch.exec(body)) !== null) {
      const v = parseInt(rm[1], 10);
      if (v >= 40 && v <= 99) ratings.push(v);
    }
    const rating = ratings[0];
    if (!rating) continue;

    // Club: try <a href="/team/..."> or <img alt="Club Name" src="/team...">.
    let club: string | null = null;
    const clubAnchorMatch = /<a[^>]+href=["']\/team\/\d+[^"']*["'][^>]*>([^<]+)<\/a>/i.exec(body);
    if (clubAnchorMatch) {
      club = decodeEntities(clubAnchorMatch[1]).trim() || null;
    } else {
      const clubImgMatch = /<img[^>]+src=["'][^"']*\/team\/[^"']+["'][^>]+alt=["']([^"']+)["']/i.exec(
        body,
      );
      if (clubImgMatch) club = decodeEntities(clubImgMatch[1]).trim() || null;
    }

    // Nation: <img alt="Argentina" src="/flags/..."> or similar.
    let nation: string | null = null;
    const nationImgMatch = /<img[^>]+src=["'][^"']*\/flags?\/[^"']+["'][^>]+alt=["']([^"']+)["']/i.exec(
      body,
    );
    if (nationImgMatch) nation = decodeEntities(nationImgMatch[1]).trim() || null;

    rows.push({
      source_dataset: DATASET_TAG,
      source_row_id: id,
      name,
      slug: slugify(name),
      rating,
      position,
      alt_positions: null,
      club,
      league: null,
      nation,
      item_type: "normal",
      value_coins_estimate: null,
      attributes: {},
    });
  }

  return rows;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch one sofifa page of HTML. Non-2xx throws so the orchestrator logs
 * the failure cleanly.
 */
export async function fetchSofifaPage(
  offset: number,
  limit: number,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${SOFIFA_BASE}?offset=${offset}&limit=${limit}`;
  const resp = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (compatible; CADE-FC26-Refresh/1.0)",
    },
  });
  if (!resp.ok) {
    throw new Error(`sofifa offset ${offset}: HTTP ${resp.status}`);
  }
  return await resp.text();
}

/**
 * Top-level entry. Walks DEFAULT_PAGES pages @ DEFAULT_LIMIT rows each,
 * rate-limited at 1 req/sec.
 */
export async function fetchSofifa(opts: SofifaFetchOptions = {}): Promise<SourceResult> {
  const pages = Math.min(opts.pages ?? DEFAULT_PAGES, MAX_PAGES);
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const sleepImpl = opts.sleepImpl ?? defaultSleep;

  const rows: NormalizedFCRow[] = [];
  for (let page = 0; page < pages; page += 1) {
    if (page > 0) {
      await sleepImpl(RATE_LIMIT_MS);
    }
    const html = await fetchSofifaPage(page * limit, limit, {
      fetchImpl: opts.fetchImpl,
    });
    const parsed = parseSofifaHtml(html);
    if (parsed.length === 0 && page > 0) {
      // Ran past the last page.
      break;
    }
    rows.push(...parsed);
  }

  return { source: "sofifa", rows };
}
