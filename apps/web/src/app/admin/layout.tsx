import { ReactNode } from "react";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getUnreadCountForAuthUser } from "@/lib/notifications/unreadCount";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const sb = await getServerSupabase();
  const unread = await getUnreadCountForAuthUser(sb);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="font-semibold">CADE League · Admin</h1>
          <div className="flex items-center gap-4">
            <Link
              href="/admin/announcements"
              aria-label="Notifications"
              className="relative text-sm"
              data-testid="bell"
            >
              Bell
              {unread > 0 ? (
                <span
                  className="absolute -top-2 -right-3 bg-red-600 text-white text-xs rounded-full px-1.5"
                  data-testid="bell-count"
                >
                  {unread}
                </span>
              ) : null}
            </Link>
            <form action="/logout" method="post">
              <button className="text-sm underline" type="submit">
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-6">{children}</main>
    </div>
  );
}
