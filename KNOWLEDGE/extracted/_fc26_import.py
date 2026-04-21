"""Plan 21 — FC 26 Kaggle dump importer.

Reads `KNOWLEDGE/extracted/fc26_players_kaggle.csv` (the unzipped Kaggle
download from flynn28/eafc26-player-database), normalizes columns to
`public.fc26_players`, and upserts via psycopg2 against `SUPABASE_DB_URL`.

If the CSV is missing, prints clear runbook instructions and exits 0 — keeps
fresh clones / CI green. If `SUPABASE_DB_URL` is unset, prints setup steps
and exits 1.

Run:
    python KNOWLEDGE/extracted/_fc26_import.py

Idempotent: re-running with the same CSV updates rows in place via
`(source_dataset, source_row_id)` unique constraint.
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any, Iterable

DATASET_URL = "https://www.kaggle.com/datasets/flynn28/eafc26-player-database"
CSV_PATH = (
    Path(__file__).resolve().parent / "fc26_players_kaggle.csv"
)
RUNBOOK_PATH = "docs/ops/fc26-data-refresh.md"

# Columns we pack into the `attributes` jsonb. Kaggle column → jsonb key.
ATTRIBUTE_COLUMNS = {
    "pace": "pace",
    "shooting": "shooting",
    "passing": "passing",
    "dribbling": "dribbling",
    "defending": "defending",
    "physical": "physical",
    # sub-attributes — best-effort; rows without these still import (key absent)
    "acceleration": "acceleration",
    "sprint_speed": "sprint_speed",
    "finishing": "finishing",
    "shot_power": "shot_power",
    "long_shots": "long_shots",
    "vision": "vision",
    "crossing": "crossing",
    "free_kick_accuracy": "free_kick_accuracy",
    "ball_control": "ball_control",
    "agility": "agility",
    "reactions": "reactions",
    "balance": "balance",
    "interceptions": "interceptions",
    "heading_accuracy": "heading_accuracy",
    "marking": "marking",
    "standing_tackle": "standing_tackle",
    "sliding_tackle": "sliding_tackle",
    "jumping": "jumping",
    "stamina": "stamina",
    "strength": "strength",
    "aggression": "aggression",
    "composure": "composure",
    "positioning": "positioning",
}

# Non-attribute columns. Kaggle column → table column.
COLUMN_MAP = {
    "id": "source_row_id",
    "name": "name",
    "short_name": "short_name",
    "overall": "rating",
    "position": "position",
    "club_name": "club",
    "league_name": "league",
    "nationality_name": "nation",
    "nationality_iso": "nation_iso",
    "age": "age",
    "height_cm": "height_cm",
    "weight_kg": "weight_kg",
    "preferred_foot": "preferred_foot",
    "weak_foot": "weak_foot",
    "skill_moves": "skill_moves",
    "body_type": "body_type",
    "attacking_work_rate": "work_rate_atk",
    "defensive_work_rate": "work_rate_def",
    "item_type": "item_type",
    "value_eur": "value_coins_estimate",
}

INT_COLUMNS = {
    "rating",
    "age",
    "height_cm",
    "weight_kg",
    "weak_foot",
    "skill_moves",
}
BIGINT_COLUMNS = {"value_coins_estimate"}

WORK_RATE_VALUES = {"Low", "Medium", "High"}
PREF_FOOT_VALUES = {"Left", "Right"}


def strip_diacritics(text: str) -> str:
    """Remove combining marks: 'Pépé' → 'Pepe'."""
    return "".join(
        c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)
    )


def slugify(name: str) -> str:
    """Lowercase, diacritic-free, non-alphanumeric → underscore.

    Must match `apps/web/src/server/fcdb/slug.ts` semantics.
    """
    s = strip_diacritics(name).lower().strip()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def parse_int(raw: Any) -> int | None:
    if raw is None or raw == "":
        return None
    try:
        return int(float(raw))
    except (ValueError, TypeError):
        return None


def parse_alt_positions(raw: Any) -> list[str] | None:
    if not raw:
        return None
    if isinstance(raw, list):
        return raw
    parts = [p.strip() for p in str(raw).split(",") if p.strip()]
    return parts or None


def normalize_work_rate(raw: Any) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip().capitalize()
    return s if s in WORK_RATE_VALUES else None


def normalize_pref_foot(raw: Any) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip().capitalize()
    return s if s in PREF_FOOT_VALUES else None


def normalize_item_type(raw: Any) -> str:
    if raw is None or raw == "":
        return "normal"
    s = str(raw).strip().lower()
    # Map common Kaggle values into our enum-ish set.
    aliases = {
        "gold": "normal",
        "silver": "normal",
        "bronze": "normal",
        "rare_gold": "normal",
        "totw": "totw",
        "icon": "icon",
        "hero": "hero",
        "evolution": "evolution",
        "evo": "evolution",
        "special": "special",
    }
    return aliases.get(s, "other")


def normalize_row(row: dict[str, Any]) -> dict[str, Any] | None:
    """Map a CSV row → table row dict. Returns None if row is unusable."""
    name = (row.get("name") or row.get("long_name") or "").strip()
    rating = parse_int(row.get("overall") or row.get("rating"))
    if not name or rating is None:
        return None

    out: dict[str, Any] = {
        "source_dataset": DATASET_URL,
        "name": name,
        "slug": slugify(name),
        "rating": max(1, min(99, rating)),
        "position": (row.get("position") or row.get("club_position") or "ST").strip()[:8],
    }

    # Map standard columns.
    for src, dst in COLUMN_MAP.items():
        if dst in out:
            continue  # already set above
        v = row.get(src)
        if v is None or v == "":
            continue
        if dst in INT_COLUMNS:
            iv = parse_int(v)
            if iv is not None:
                out[dst] = iv
        elif dst in BIGINT_COLUMNS:
            iv = parse_int(v)
            if iv is not None:
                out[dst] = iv
        elif dst == "work_rate_atk" or dst == "work_rate_def":
            wr = normalize_work_rate(v)
            if wr:
                out[dst] = wr
        elif dst == "preferred_foot":
            pf = normalize_pref_foot(v)
            if pf:
                out[dst] = pf
        elif dst == "item_type":
            out[dst] = normalize_item_type(v)
        elif dst == "source_row_id":
            out[dst] = str(v).strip()
        else:
            out[dst] = str(v).strip()

    # Defaults.
    out.setdefault("item_type", "normal")
    out.setdefault("source_row_id", out.get("source_row_id") or out["slug"])

    # alt_positions array.
    alt = parse_alt_positions(row.get("alt_positions") or row.get("player_positions"))
    if alt:
        out["alt_positions"] = alt

    # Pack attributes jsonb.
    attrs: dict[str, int] = {}
    for src, key in ATTRIBUTE_COLUMNS.items():
        v = parse_int(row.get(src))
        if v is not None:
            attrs[key] = v
    out["attributes"] = json.dumps(attrs)

    return out


# Insert column order — must match VALUES placeholders.
INSERT_COLUMNS = [
    "source_dataset",
    "source_row_id",
    "name",
    "short_name",
    "slug",
    "rating",
    "position",
    "alt_positions",
    "club",
    "league",
    "nation",
    "nation_iso",
    "age",
    "height_cm",
    "weight_kg",
    "preferred_foot",
    "weak_foot",
    "skill_moves",
    "body_type",
    "work_rate_atk",
    "work_rate_def",
    "attributes",
    "item_type",
    "value_coins_estimate",
]


def build_insert_sql() -> str:
    cols = ", ".join(INSERT_COLUMNS)
    placeholders = ", ".join(f"%({c})s" for c in INSERT_COLUMNS)
    update_pairs = ", ".join(
        f"{c} = excluded.{c}"
        for c in INSERT_COLUMNS
        if c not in {"source_dataset", "source_row_id"}
    )
    return f"""
        insert into public.fc26_players ({cols}, imported_at, updated_at)
        values ({placeholders}, now(), now())
        on conflict (source_dataset, source_row_id)
        where deleted_at is null
        do update set {update_pairs}, updated_at = now();
    """


def csv_missing_message() -> str:
    return f"""
[fc26 importer] CSV not found at: {CSV_PATH}

To populate the FC 26 player catalogue:

  1. Drop your Kaggle API token at ~/.kaggle/kaggle.json (chmod 600).
  2. pip install kaggle
  3. kaggle datasets download -d flynn28/eafc26-player-database \\
       -p KNOWLEDGE/extracted/ --unzip
  4. Re-run: python KNOWLEDGE/extracted/_fc26_import.py

See {RUNBOOK_PATH} for the full procedure (dataset URL: {DATASET_URL}).
Exiting 0 — this is not an error.
""".strip()


def db_url_missing_message() -> str:
    return """
[fc26 importer] SUPABASE_DB_URL is not set.

Set it to the linked project's pooler connection string, e.g.:

  export SUPABASE_DB_URL="postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:6543/postgres"

(Find this under Supabase → Project Settings → Database → Connection string.)
""".strip()


def iter_rows(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            normalized = normalize_row(row)
            if normalized is not None:
                yield normalized


def main() -> int:
    if not CSV_PATH.exists():
        print(csv_missing_message())
        return 0

    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print(db_url_missing_message())
        return 1

    try:
        import psycopg2  # type: ignore
        from psycopg2.extras import execute_batch  # type: ignore
    except ImportError:
        print(
            "[fc26 importer] psycopg2 not installed. Run:\n"
            "    pip install psycopg2-binary"
        )
        return 1

    sql = build_insert_sql()
    started = time.monotonic()
    inserted = 0
    batch: list[dict[str, Any]] = []
    BATCH_SIZE = 500

    print(f"[fc26 importer] reading {CSV_PATH}")
    print(f"[fc26 importer] target dataset: {DATASET_URL}")

    conn = psycopg2.connect(db_url)
    try:
        with conn:
            with conn.cursor() as cur:
                for row in iter_rows(CSV_PATH):
                    # Fill missing optional columns with None for placeholder safety.
                    for col in INSERT_COLUMNS:
                        row.setdefault(col, None)
                    batch.append(row)
                    if len(batch) >= BATCH_SIZE:
                        execute_batch(cur, sql, batch, page_size=BATCH_SIZE)
                        inserted += len(batch)
                        batch.clear()
                if batch:
                    execute_batch(cur, sql, batch, page_size=BATCH_SIZE)
                    inserted += len(batch)
                    batch.clear()
    finally:
        conn.close()

    elapsed = time.monotonic() - started
    print(
        f"[fc26 importer] processed {inserted} rows in {elapsed:.1f}s "
        f"(upsert via source_dataset + source_row_id)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
