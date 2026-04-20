import { ReactNode } from "react";
import { TrashTabs } from "./TrashTabs";
import { SectionHeader } from "@/components/admin/SectionHeader";

export default function TrashLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Recovery"
        title="Trash"
        description="Soft-deleted rows across the system. Restore to revert. Purge hardens after 30 days (deferred to Phase 1B)."
      />
      <TrashTabs />
      {children}
    </div>
  );
}
