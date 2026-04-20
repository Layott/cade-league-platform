import { ReactNode } from "react";
import { AdminShell } from "@/components/admin/AdminShell";

/**
 * /admin/* layout. The outer SiteChrome (global nav, bell, sign-out) is
 * still visible above this because we removed the old hide-on-/admin
 * rule. This layout only adds the admin-internal chrome: eyebrow tag,
 * back-to-site link, and tab subnav.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
