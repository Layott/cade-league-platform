"use client";

import { DangerButton } from "@/components/admin/buttons";
import { endSessionAction } from "../../actions";

/**
 * Plan 52 — End-session button for the v2 control room.
 *
 * Wraps the legacy `endSessionAction` in a tiny client form so we can
 * surface a `window.confirm` before the action fires. The action sets
 * `stream_sessions.ended_at = now()`, clears any still-active overlay
 * events, then redirects back to `/admin/broadcast/v2`.
 *
 * Gated upstream by `canManage` (broadcast.manage perm) — the button
 * only renders for producers + admins on a live session.
 */
export function EndSessionForm({ sessionId }: { sessionId: string }) {
  return (
    <form
      action={endSessionAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "End this stream session? Active overlays will be cleared.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="sessionId" value={sessionId} />
      <DangerButton type="submit" data-testid="end-session-btn">
        End session
      </DangerButton>
    </form>
  );
}
