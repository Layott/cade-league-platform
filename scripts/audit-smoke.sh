#!/usr/bin/env bash
# Run the audit-smoke assertion test against the linked Supabase project.
# Requires `npx supabase link` to have been run.
# Requires SUPABASE_ACCESS_TOKEN env var.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

npx --yes supabase db query --file supabase/tests/audit_smoke.sql --linked
