#!/usr/bin/env bash
# Run the void-propagation smoke test against the linked Supabase project.
# Requires `npx supabase link` + SUPABASE_ACCESS_TOKEN.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

npx --yes supabase db query --file supabase/tests/void_propagation_smoke.sql --linked
