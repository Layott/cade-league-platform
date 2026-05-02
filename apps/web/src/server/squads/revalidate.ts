import { revalidatePath } from "next/cache";

/**
 * 2026-05-02 — `revalidateSquadSurfaces`.
 *
 * Single source of truth for "a squad submission landed / changed —
 * bust every cache that surfaces this player's roster". Called from:
 *   - `submitPickerAction` (player files / re-files a squad)
 *   - `applySquadToMultipleMatchDaysAction` (per applied match day)
 *   - `requestChangeAction` (Friday change window edits)
 *   - admin approve / reject / reopen actions on `/admin/squads`
 *
 * Why a helper instead of inlining `revalidatePath` everywhere:
 *   1. Single audit trail for "what surfaces depend on this state".
 *      When we add a new surface (say `/squads` public board) we touch
 *      ONE file, not five.
 *   2. Layout-form revalidation. Deep `[id]` pages cache aggressively
 *      under Next 15's cache components — passing `'layout'` busts the
 *      whole subtree, not just the page-level fetch.
 *   3. Admin design page (`/admin/broadcast/v2/design`) renders the
 *      same overlay HTML the live OBS source consumes. Without busting
 *      its layout the design preview shows stale roster after a player
 *      submits.
 *
 * Surfaces (post-2026-05-02):
 *   - `/player/squad`              — player's own picker + summary
 *   - `/admin/squads`              — admin queue list
 *   - `/admin/squads/<id>`         — admin detail (if submissionId)
 *   - `/admin/broadcast/v2`        — broadcast hub
 *   - `/admin/broadcast/v2/design` — overlay design preview
 *   - `/players/<playerId>`        — public player profile
 *
 * No-op when called outside a request context (e.g. inside a unit test
 * that mocks `next/cache`); the caller is responsible for short-circuiting
 * if cache busting is irrelevant to that flow.
 */

export type RevalidateSquadSurfacesInput = {
  playerId: string;
  matchDayId?: string | null;
  /**
   * Optional submission id so the admin detail route's nested layout
   * (`/admin/squads/<id>`) is busted as well. Skip when the caller doesn't
   * know the id (e.g. apply-to-multiple over many target match days, where
   * we revalidate the queue once per target without per-detail walks).
   */
  submissionId?: string | null;
};

export function revalidateSquadSurfaces(
  input: RevalidateSquadSurfacesInput,
): void {
  // Player-facing surfaces.
  revalidatePath("/player/squad", "page");
  if (input.playerId) {
    // Public player profile renders the latest squad summary.
    revalidatePath(`/players/${input.playerId}`, "page");
  }

  // Admin-facing surfaces — list + detail + broadcast hub + design.
  revalidatePath("/admin/squads", "page");
  if (input.submissionId) {
    revalidatePath(`/admin/squads/${input.submissionId}`, "page");
  }
  // Layout-form on /admin/broadcast/v2 + /admin/broadcast/v2/design — the
  // overlay preview iframes mounted in the design editor + the broadcast
  // hub's mini-previews need to repaint with the fresh squad data on
  // their next render. Without layout-form revalidation the SSR-injected
  // design tokens block the cache from returning the new payload until
  // the next manual reload.
  revalidatePath("/admin/broadcast/v2", "layout");
  revalidatePath("/admin/broadcast/v2/design", "layout");
}
