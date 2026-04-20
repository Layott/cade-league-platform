#!/usr/bin/env bash
# Create a Supabase Auth user via the admin API. Useful for seeding dev data.
#
# Usage:
#   scripts/create-auth-user.sh <email> <password> [displayName]
#
# Requires SUPABASE_SERVICE_ROLE_KEY (usually in root .env.local) and
# NEXT_PUBLIC_SUPABASE_URL to be set in the environment.

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <email> <password> [displayName]" >&2
  exit 1
fi

EMAIL="$1"
PASSWORD="$2"
DISPLAY_NAME="${3:-$(echo "$EMAIL" | cut -d@ -f1)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load root .env.local if SUPABASE_* vars aren't already in the env.
if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" && -f "$REPO_ROOT/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env.local"
  set +a
fi
if [[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" && -f "$REPO_ROOT/apps/web/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/apps/web/.env.local"
  set +a
fi

: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL not set}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set}"

payload=$(cat <<EOF
{
  "email": "$EMAIL",
  "password": "$PASSWORD",
  "email_confirm": true,
  "user_metadata": { "display_name": "$DISPLAY_NAME" }
}
EOF
)

curl -sS -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/users" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "$payload"
echo
