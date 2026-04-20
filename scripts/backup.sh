#!/usr/bin/env bash
# Daily database backup. Writes a .sql dump via the Supabase CLI to backups/.
# Rotates to keep the last 14 days.
#
# Usage:
#   scripts/backup.sh
#
# Requires `npx supabase link` already run + SUPABASE_ACCESS_TOKEN + SUPABASE_DB_PASSWORD.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -f "$REPO_ROOT/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env.local"
  set +a
fi

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN not set}"

mkdir -p "$REPO_ROOT/backups"

STAMP="$(date +%Y-%m-%d)"
OUT="$REPO_ROOT/backups/cade-$STAMP.sql"

echo "Dumping linked project → $OUT"
cd "$REPO_ROOT"
npx --yes supabase db dump --linked --schema public > "$OUT"

# Rotate: keep newest 14 files.
ls -t "$REPO_ROOT/backups"/cade-*.sql 2>/dev/null | tail -n +15 | xargs -r rm --

echo "Backup complete. Retained backups:"
ls -lh "$REPO_ROOT/backups"/cade-*.sql 2>/dev/null || true
