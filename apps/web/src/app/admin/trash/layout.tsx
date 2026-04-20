import Link from "next/link";
import { ReactNode } from "react";
import { TRASH_ENTITIES, TRASH_ENTITY_KEYS } from "@/server/trash/entities";

export default function TrashLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-2xl font-bold">Trash</h2>
        <p className="text-gray-600 text-sm">
          Soft-deleted rows across the system. Restore to revert. Purge hardens
          after 30 days (deferred to Phase 1B).
        </p>
      </header>
      <nav
        className="flex gap-1 border-b overflow-x-auto text-sm"
        aria-label="Trash entity types"
      >
        {TRASH_ENTITY_KEYS.map((key) => (
          <Link
            key={key}
            href={`/admin/trash/${key}`}
            className="px-3 py-2 border-b-2 whitespace-nowrap border-transparent text-gray-600 hover:text-black"
          >
            {TRASH_ENTITIES[key].label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
