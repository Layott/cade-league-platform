import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { listForUser, NOTIFICATION_KINDS } from "@/server/notifications";
import { formatWat } from "@/lib/time";
import { NotificationsFilters } from "./NotificationsFilters";

export const dynamic = "force-dynamic";

/**
 * 2026-04-24 — /notifications listing page.
 *
 * Server-rendered full history of the signed-in user's notifications,
 * with a client-island filter-by-kind + "Mark all read" button. Clicking
 * a row navigates to its `href` (if any) and the client island does the
 * mark-read POST; a link without js still works because each row is a
 * real <a>.
 *
 * Pagination: start with a 200-row limit — well beyond what a player
 * should ever accumulate. If a user's notification volume grows past
 * this we add offset-based pagination; out-of-scope for now.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ kind?: string; unread?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/login?next=/notifications");
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!pub) redirect("/login?next=/notifications");

  const rows = await listForUser(sb, pub.id, { limit: 200 });
  const kindFilter = sp.kind && NOTIFICATION_KINDS.includes(sp.kind as (typeof NOTIFICATION_KINDS)[number])
    ? (sp.kind as (typeof NOTIFICATION_KINDS)[number])
    : null;
  const unreadOnly = sp.unread === "1";
  const filtered = rows.filter((r) => {
    if (kindFilter && r.type !== kindFilter) return false;
    if (unreadOnly && r.read_at) return false;
    return true;
  });

  const unreadTotal = rows.filter((r) => !r.read_at).length;

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-[var(--chalk-0)]">
            Notifications
          </h1>
          <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
            {rows.length} total · {unreadTotal} unread
          </p>
        </div>
      </div>

      <NotificationsFilters
        currentKind={kindFilter}
        unreadOnly={unreadOnly}
        kinds={NOTIFICATION_KINDS as readonly string[]}
      />

      {filtered.length === 0 ? (
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-5 py-8 text-center text-sm text-[var(--chalk-3)]">
          Nothing here yet.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--ink-4)] rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]">
          {filtered.map((r) => {
            const href = r.href ?? "#";
            const isLink = !!r.href;
            const Inner = (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="pt-1.5">
                  {!r.read_at ? (
                    <span
                      aria-label="Unread"
                      className="inline-block h-2 w-2 rounded-full bg-[var(--signal)]"
                    />
                  ) : (
                    <span aria-hidden className="inline-block h-2 w-2" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={
                      "text-[14px] " +
                      (r.read_at
                        ? "text-[var(--chalk-2)]"
                        : "font-bold text-[var(--chalk-0)]")
                    }
                  >
                    {r.title ?? "(no title)"}
                  </div>
                  {r.body ? (
                    <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--chalk-2)]">
                      {r.body}
                    </p>
                  ) : null}
                  <p className="tabular mt-1 text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
                    {formatWat(r.created_at, "EEE dd MMM yyyy · HH:mm")} WAT ·{" "}
                    <span>{r.type.replace(/_/g, " ")}</span>
                    {r.email_sent_at ? " · emailed" : ""}
                  </p>
                </div>
              </div>
            );
            return (
              <li key={r.id}>
                {isLink ? (
                  <Link
                    href={href}
                    className="block transition-colors hover:bg-[var(--ink-2)] focus:bg-[var(--ink-2)] focus:outline-none"
                    data-testid={`notifications-list-row-${r.id}`}
                  >
                    {Inner}
                  </Link>
                ) : (
                  <div
                    className="block"
                    data-testid={`notifications-list-row-${r.id}`}
                  >
                    {Inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
