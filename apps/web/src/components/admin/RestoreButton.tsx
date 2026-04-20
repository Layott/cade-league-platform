import { restoreAction } from "@/app/admin/trash/[entity]/actions";

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
        className="text-blue-600 underline text-sm"
        type="submit"
        data-testid="restore-button"
      >
        Restore
      </button>
    </form>
  );
}
