import { restoreAction } from "@/app/admin/system/trash/[entity]/actions";

/**
 * Inline server-action form that restores a soft-deleted row.
 * Styled to match the admin console: chalky outline pill that flips
 * to signal green on hover.
 */
export function RestoreButton({
  entityType,
  id,
}: {
  entityType: string;
  id: string;
}) {
  return (
    <form action={restoreAction}>
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        data-testid="restore-button"
        className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-2)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)]"
      >
        <span aria-hidden>↺</span> Restore
      </button>
    </form>
  );
}
