export function PurgeButtonStub() {
  return (
    <button
      type="button"
      disabled
      title="30-day purge deferred to Phase 1B"
      className="text-gray-400 text-sm cursor-not-allowed"
      data-testid="purge-button-stub"
    >
      Purge
    </button>
  );
}
