/**
 * Disabled Purge button. Shows the intent without enabling the action —
 * the 30-day hard-delete flow is deferred to Phase 1B. Playwright's trash
 * spec asserts the tooltip text, so keep the `title` substring in sync.
 */
export function PurgeButtonStub() {
  return (
    <button
      type="button"
      disabled
      title="30-day purge deferred to Phase 1B"
      data-testid="purge-button-stub"
      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-sm border border-dashed border-[var(--ink-4)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-3)]"
    >
      Purge
    </button>
  );
}
