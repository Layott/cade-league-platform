#!/usr/bin/env bash
# Plan 51 migration smoke: verifies the 20260525000001..03 claim block is
# applied to the linked Supabase project and the columns/constraints/perms
# match the spec. Requires `npx supabase link` + SUPABASE_ACCESS_TOKEN.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

npx --yes supabase db query --file supabase/tests/plan51_smoke.sql --linked
