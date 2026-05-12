#!/usr/bin/env python3
# ruff: noqa: E501
r"""
Futbin scraper built on Scrapling (https://github.com/D4Vinci/Scrapling).

Why this exists alongside the Node scrapers:
  * Scrapling's StealthyFetcher auto-solves Cloudflare Turnstile without
    a headful "warm the profile" pre-step. No manual checkbox click.
  * AsyncStealthySession(max_pages=N) gives a true rotating tab pool —
    fetch N pages concurrently in ONE Chromium instance vs N separate
    Chromium instances in the Node parallel scraper. Much lighter RAM,
    much faster CF clearance reuse.
  * Adaptive selectors (auto_save + adaptive=True) survive Futbin's
    occasional class-name churn without code edits.

Usage (Windows PowerShell):
  py -m venv .scrapling-venv
  .\.scrapling-venv\Scripts\Activate.ps1
  pip install "scrapling[all]>=0.4.8" supabase python-dotenv
  scrapling install --force
  py KNOWLEDGE/extracted/_scrape_futbin_scrapling.py --from 1 --to 50 --tabs 8

Flags:
  --from N         start page (default 1)
  --to N           end page (default 600)
  --tabs N         concurrent browser tabs (default 8, max 16)
  --reset          ignore checkpoint, restart from --from
  --headful        run visible (default headless)

Auto-close: process exits 0 on completion. When invoked via
KNOWLEDGE/extracted/run/scrapling.bat (or .ps1), the cmd window closes
itself — no key press required.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import signal
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any

# --- env loading ---------------------------------------------------------
THIS_DIR = Path(__file__).resolve().parent
ENV_PATH = THIS_DIR.parent.parent / "apps" / "web" / ".env.local"
STATE_PATH = THIS_DIR / "futbin_scrapling_state.json"
RUN_LOG_PATH = THIS_DIR / "futbin_scrapling_runlog.json"
PROFILE_DIR = THIS_DIR / ".futbin_scrapling_profile"


def load_env() -> None:
    if not ENV_PATH.exists():
        sys.exit(f"[fatal] env file missing: {ENV_PATH}")
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^(\w+)=(.*)$", line)
        if m:
            os.environ[m.group(1)] = m.group(2).strip('"')


# --- helpers -------------------------------------------------------------
def slugify(name: str | None) -> str:
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def parse_coins(raw: str | None) -> int | None:
    if not raw:
        return None
    s = str(raw).strip().replace(",", "")
    if re.match(r"^(-|0|sbc|untradeable|n/a|extinct)$", s, re.IGNORECASE):
        return None
    m = re.match(r"^([\d.]+)\s*([KMB])?$", s, re.IGNORECASE)
    if not m:
        return None
    mult = {"K": 1e3, "M": 1e6, "B": 1e9}.get((m.group(2) or "").upper(), 1)
    return round(float(m.group(1)) * mult)


def classify_item_type(variant: str | None) -> str:
    v = (variant or "").lower()
    if re.search(r"\bicon\b", v):
        return "icon"
    if re.search(r"\btoty\b", v):
        return "toty"
    if re.search(r"\btots\b|team-of-the-season", v):
        return "tots"
    if re.search(r"\btotw\b|\bin-form\b|\bif\b", v):
        return "totw"
    if re.search(r"\bhero(es)?\b", v):
        return "hero"
    if re.search(r"\brttf\b|road-to", v):
        return "rttf"
    if not re.match(r"^(\d+-)?(gold|silver|bronze|rare|common|normal)$", v):
        return "special"
    return "normal"


def load_state() -> dict[str, Any]:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"lastPage": 0}


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


# --- row extraction ------------------------------------------------------
ROW_JS = r"""
() => {
  const rows = Array.from(document.querySelectorAll('tr.player-row'));
  const out = [];
  for (const row of rows) {
    const cardAnchor = row.querySelector("a.player-row-playercard, a[href*='/26/player/']");
    const hrefM = (cardAnchor?.getAttribute('href') || '').match(/\/26\/player\/(\d+)\/([^/?#]+)/);
    if (!hrefM) continue;
    const name = row.querySelector('a.table-player-name')?.textContent?.trim()
              || row.querySelector('[title]')?.getAttribute('title')?.trim() || null;
    const ratingText = row.querySelector('td.table-rating .rating-square, td.table-rating')?.textContent?.trim();
    const rating = ratingText ? parseInt(ratingText, 10) : null;
    if (!name || !rating) continue;
    const intText = (sel) => {
      const t = row.querySelector(sel)?.textContent?.trim();
      const n = t ? parseInt(t, 10) : NaN;
      return Number.isFinite(n) ? n : null;
    };
    const cardImgEl =
      row.querySelector(".playercard-26 img[alt]:not([alt=''])") ||
      row.querySelector(".playercard-26-special-img") ||
      row.querySelector("img[src*='/img/players/']");
    const bgEl =
      row.querySelector('img.playercard-s-26-bg') ||
      row.querySelector(".playercard-s-26-bg img") ||
      row.querySelector("img[src*='/img/cards/tiny/']") ||
      row.querySelector("img[src*='/img/cards/']");
    const cardBgSrc = bgEl?.getAttribute('src') || bgEl?.getAttribute('data-src') || '';
    const variantM = cardBgSrc.match(/\/cards\/[^/]+\/([^.?]+)\.(?:png|webp|jpg)/i);
    const posTd = row.querySelector('td.table-pos');
    const primaryPos = posTd?.querySelector('.table-pos-main span')?.textContent?.trim() || null;
    const altPosText = posTd?.querySelector('.xs-font.text-faded.bold')?.textContent?.trim() || '';
    const altPositions = altPosText ? altPosText.split(',').map(s => s.trim()).filter(Boolean) : [];
    const nationImg = row.querySelector("img.nation, img[src*='/img/nation/']");
    const leagueImg = row.querySelector("img[src*='/img/league/']");
    const clubImg = row.querySelector("img[src*='/img/clubs/']");
    const pathId = (src) => {
      const m = (src || '').match(/\/img\/(?:nation|league|clubs)\/(?:dark\/|light\/)?(\d+)\.(?:png|webp|jpg)/i);
      return m ? parseInt(m[1], 10) : null;
    };
    out.push({
      resourceId: hrefM[1],
      slug: hrefM[2],
      name,
      rating,
      position: primaryPos || row.querySelector('td.table-position, .playercard-s-26-pos')?.textContent?.trim() || null,
      altPositions,
      variant: variantM ? variantM[1].replace(/_/g, '-') : null,
      pricePs: row.querySelector('td.table-price.platform-ps-only .price')?.textContent?.trim() || null,
      pricePc: row.querySelector('td.table-price.platform-pc-only .price')?.textContent?.trim() || null,
      stats: {
        pac: intText('td.table-pace .table-key-stats, td.table-pace'),
        sho: intText('td.table-shooting .table-key-stats, td.table-shooting'),
        pas: intText('td.table-passing .table-key-stats, td.table-passing'),
        dri: intText('td.table-dribbling .table-key-stats, td.table-dribbling'),
        def: intText('td.table-defending .table-key-stats, td.table-defending'),
        phy: intText('td.table-physicality .table-key-stats, td.table-physicality'),
      },
      weakFoot: intText('td.table-weak-foot'),
      skillMoves: intText('td.table-skills'),
      metaTag: row.querySelector('.futbin-rating-tag')?.textContent?.trim() || null,
      cardImageUrl: cardImgEl?.getAttribute('src') || null,
      cardBgUrl: cardBgSrc || null,
      club: row.querySelector('a.table-player-club img[title]')?.getAttribute('title')?.trim() || null,
      league: row.querySelector('a.table-player-league img[title]')?.getAttribute('title')?.trim() || null,
      nationId: pathId(nationImg?.getAttribute('src')),
      leagueId: pathId(leagueImg?.getAttribute('src')),
      clubId: pathId(clubImg?.getAttribute('src')),
      nationFlagUrl: nationImg?.getAttribute('src') || null,
      leagueFlagUrl: leagueImg?.getAttribute('src') || null,
      clubLogoUrl: clubImg?.getAttribute('src') || null,
    });
  }
  return out;
}
"""


async def fetch_page(session, page_num: int) -> list[dict[str, Any]]:
    """Fetch one Futbin list page through the StealthySession tab pool."""
    url = f"https://www.futbin.com/26/players?page={page_num}"

    async def evaluate_rows(page):  # Playwright page object
        await page.wait_for_timeout(2000)
        return await page.evaluate(ROW_JS)

    resp = await session.fetch(
        url,
        page_action=evaluate_rows,
        wait_selector="tr.player-row",
        wait_selector_state="attached",
        timeout=60_000,
    )
    # page_action's return propagates onto resp.adaptor result; Scrapling
    # also makes page DOM available via resp.css if extract didn't run.
    rows = getattr(resp, "page_action_result", None)
    if rows is not None:
        return rows
    # Fallback: parse via Scrapling selectors if page_action_result is empty.
    parsed: list[dict[str, Any]] = []
    for row in resp.css("tr.player-row"):
        href = row.css("a.player-row-playercard, a[href*='/26/player/']::attr(href)").get("")
        m = re.search(r"/26/player/(\d+)/([^/?#]+)", href or "")
        if not m:
            continue
        name = row.css("a.table-player-name::text").get("").strip() or None
        rating_text = row.css("td.table-rating .rating-square::text, td.table-rating::text").get("")
        try:
            rating = int(rating_text.strip())
        except ValueError:
            continue
        parsed.append({
            "resourceId": m.group(1),
            "slug": m.group(2),
            "name": name,
            "rating": rating,
            "pricePs": row.css("td.table-price.platform-ps-only .price::text").get(""),
            "pricePc": row.css("td.table-price.platform-pc-only .price::text").get(""),
            "variant": None, "stats": {}, "metaTag": None,
            "cardImageUrl": None, "cardBgUrl": None,
            "position": None, "altPositions": [],
            "club": None, "league": None,
            "weakFoot": None, "skillMoves": None,
            "nationId": None, "leagueId": None, "clubId": None,
            "nationFlagUrl": None, "leagueFlagUrl": None, "clubLogoUrl": None,
        })
    return parsed


# --- supabase upsert -----------------------------------------------------
def build_attrs(r: dict[str, Any], coins_ps: int | None, coins_pc: int | None,
                existing: dict[str, Any]) -> dict[str, Any]:
    attrs = dict(existing) if isinstance(existing, dict) else {}
    attrs["price_source"] = "futbin_live"
    attrs["price_snapshot_at"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    attrs["futbin_resource_id"] = r["resourceId"]
    attrs["futbin_variant"] = r.get("variant") or "normal"
    attrs["platform_prices"] = {"ps": coins_ps, "pc": coins_pc}
    if r.get("stats"):
        attrs["mains"] = r["stats"]
    for key, src in (("weak_foot", "weakFoot"), ("skill_moves", "skillMoves")):
        if r.get(src) is not None:
            attrs[key] = r[src]
    if r.get("metaTag"):
        attrs["futbin_meta_rating"] = r["metaTag"]
    if r.get("cardImageUrl"):
        url = r["cardImageUrl"]
        attrs["card_image_url"] = url if url.startswith("http") else f"https://www.futbin.com{url}"
    if r.get("cardBgUrl"):
        url = r["cardBgUrl"]
        attrs["card_bg_url"] = url if url.startswith("http") else f"https://www.futbin.com{url}"
    for key, src in (("futbin_nation_id", "nationId"), ("futbin_league_id", "leagueId"),
                     ("futbin_club_id", "clubId")):
        if r.get(src) is not None:
            attrs[key] = r[src]
    for key, src in (("nation_flag_url", "nationFlagUrl"), ("league_logo_url", "leagueFlagUrl"),
                     ("club_logo_url", "clubLogoUrl")):
        if r.get(src):
            url = r[src]
            attrs[key] = url if url.startswith("http") else f"https://www.futbin.com{url}"
    if r.get("club"):
        attrs["club_name"] = r["club"]
    if r.get("league"):
        attrs["league_name"] = r["league"]
    if r.get("altPositions"):
        attrs["alt_positions"] = list(r["altPositions"])
    return attrs


async def upsert_row(sb, r: dict[str, Any], stats: dict[str, int]) -> None:
    coins_ps = parse_coins(r.get("pricePs"))
    coins_pc = parse_coins(r.get("pricePc"))
    coins = coins_ps or coins_pc
    if not coins:
        stats["noPrice"] += 1
        return
    slug = slugify(r.get("name"))
    source_row_id = f"futbin_{r['resourceId']}"
    item_type = classify_item_type(r.get("variant"))

    res = sb.table("fc26_players").select(
        "id, rating, value_coins_estimate, item_type, attributes, club, league, alt_positions, position"
    ).eq("source_dataset", "futbin.com").eq("source_row_id", source_row_id).is_("deleted_at", "null").maybe_single().execute()
    exist = res.data if res else None

    attrs = build_attrs(r, coins_ps, coins_pc, (exist or {}).get("attributes") or {})

    if not exist:
        payload: dict[str, Any] = {
            "source_dataset": "futbin.com",
            "source_row_id": source_row_id,
            "name": r["name"],
            "slug": slug,
            "rating": r["rating"],
            "position": r.get("position") or "ST",
            "item_type": item_type,
            "value_coins_estimate": coins,
            "attributes": attrs,
        }
        if r.get("club"):
            payload["club"] = r["club"]
        if r.get("league"):
            payload["league"] = r["league"]
        if r.get("altPositions"):
            payload["alt_positions"] = r["altPositions"]
        sb.table("fc26_players").insert(payload).execute()
        stats["inserted"] += 1
    else:
        update: dict[str, Any] = {
            "rating": r["rating"],
            "position": r.get("position") or exist.get("position") or "ST",
            "value_coins_estimate": coins,
            "item_type": item_type,
            "attributes": attrs,
        }
        if r.get("club") and r["club"] != (exist.get("club") or None):
            update["club"] = r["club"]
        if r.get("league") and r["league"] != (exist.get("league") or None):
            update["league"] = r["league"]
        if r.get("altPositions"):
            old = exist.get("alt_positions") or []
            if list(old) != list(r["altPositions"]):
                update["alt_positions"] = r["altPositions"]
        sb.table("fc26_players").update(update).eq("id", exist["id"]).execute()
        stats["updated"] += 1


# --- main loop -----------------------------------------------------------
async def run(args: argparse.Namespace) -> int:
    # Lazy imports so `--help` doesn't require deps.
    try:
        from scrapling.fetchers import AsyncStealthySession
    except ImportError:
        sys.exit("[fatal] scrapling not installed. Run: pip install 'scrapling[all]>=0.4.8'")
    try:
        from supabase import create_client
    except ImportError:
        sys.exit("[fatal] supabase-py not installed. Run: pip install supabase python-dotenv")

    load_env()
    sb_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not sb_url or not sb_key:
        sys.exit("[fatal] missing supabase env vars")
    sb = create_client(sb_url, sb_key)

    state = {"lastPage": 0} if args.reset else load_state()
    start_page = max(args.from_page, state.get("lastPage", 0) + 1)
    if start_page > args.to_page:
        print(f"[scrapling] nothing to do — checkpoint at p{state['lastPage']}, --to {args.to_page}")
        return 0

    tabs = min(args.tabs, 16)
    stats = {"pages": 0, "rows": 0, "inserted": 0, "updated": 0, "noPrice": 0,
             "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())}
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[scrapling] sessions=1 tabs={tabs} pages p{start_page}..p{args.to_page}")
    print(f"[scrapling] profile_dir={PROFILE_DIR}")

    async with AsyncStealthySession(
        headless=not args.headful,
        solve_cloudflare=True,
        block_webrtc=True,
        hide_canvas=True,
        google_search=True,
        disable_resources=True,
        network_idle=False,
        max_pages=tabs,
        timeout=90_000,
        user_data_dir=str(PROFILE_DIR),
    ) as session:
        pages = list(range(start_page, args.to_page + 1))
        # Slice into batches sized = tabs to bound concurrent in-flight tabs.
        for batch_start in range(0, len(pages), tabs):
            batch = pages[batch_start:batch_start + tabs]
            results = await asyncio.gather(
                *(fetch_page(session, p) for p in batch),
                return_exceptions=True,
            )
            for pnum, rows_or_err in zip(batch, results):
                if isinstance(rows_or_err, Exception):
                    print(f"[scrapling] p{pnum} ERROR: {rows_or_err}")
                    continue
                rows = rows_or_err or []
                if not rows:
                    print(f"[scrapling] p{pnum}: 0 rows — likely end of catalogue")
                    continue
                stats["pages"] += 1
                stats["rows"] += len(rows)
                for r in rows:
                    await upsert_row(sb, r, stats)
                state["lastPage"] = pnum
                save_state(state)
                print(f"[scrapling] p{pnum}: {len(rows)} rows  ins={stats['inserted']} upd={stats['updated']} np={stats['noPrice']}")

    state["lastPage"] = 0
    save_state(state)
    stats["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())

    runlog: list[dict[str, Any]] = []
    if RUN_LOG_PATH.exists():
        try:
            runlog = json.loads(RUN_LOG_PATH.read_text(encoding="utf-8"))
        except Exception:
            runlog = []
    runlog.append(stats)
    RUN_LOG_PATH.write_text(json.dumps(runlog[-60:], indent=2), encoding="utf-8")
    print(f"[scrapling] done: {stats}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Futbin scraper on Scrapling (anti-bot, parallel tabs).")
    ap.add_argument("--from", dest="from_page", type=int, default=1)
    ap.add_argument("--to", dest="to_page", type=int, default=600)
    ap.add_argument("--tabs", type=int, default=8, help="parallel browser tabs (max 16)")
    ap.add_argument("--reset", action="store_true", help="ignore checkpoint, restart from --from")
    ap.add_argument("--headful", action="store_true", help="show browser window")
    args = ap.parse_args()

    # Graceful Ctrl+C — Scrapling's session context manager cleans up.
    stop_event = asyncio.Event()

    def _handler(signum, frame):
        print(f"\n[scrapling] received signal {signum}, finishing current batch then exiting…")
        stop_event.set()

    signal.signal(signal.SIGINT, _handler)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handler)

    try:
        return asyncio.run(run(args))
    except KeyboardInterrupt:
        print("[scrapling] interrupted")
        return 130


if __name__ == "__main__":
    sys.exit(main())
