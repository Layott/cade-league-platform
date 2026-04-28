import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { renderMarkdownToSafeHtml } from "@/server/announcements/render";
import { publishNowFromDetail, unpublishFromDetail } from "./actions";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import { PrimaryButton, SecondaryButton, DangerButton } from "@/components/admin/buttons";

export default async function AnnouncementDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await getServerSupabase();

  const { data: ann } = await sb
    .from("announcements")
    .select(
      "id, title, body_md, priority, audience_type, audience_role, channels, scheduled_publish_at, published_at, is_public",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!ann) notFound();

  const { count: totalCount } = await sb
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("announcement_id", id)
    .is("deleted_at", null);

  const { count: readCount } = await sb
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("announcement_id", id)
    .is("deleted_at", null)
    .not("read_at", "is", null);

  const html = renderMarkdownToSafeHtml(ann.body_md);
  const total = totalCount ?? 0;
  const read = readCount ?? 0;
  const pct = total === 0 ? 0 : Math.round((read / total) * 100);

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Briefing"
        title={ann.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            <StatusPill status={ann.priority} />
            <span>· Audience: {ann.audience_type}</span>
            {ann.audience_role ? <span>({ann.audience_role})</span> : null}
            {ann.is_public ? (
              <StatusPill status="active">Public</StatusPill>
            ) : null}
          </span>
        }
        action={
          <Link href="/admin/announcements">
            <SecondaryButton type="button">← Back to list</SecondaryButton>
          </Link>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatusCard
          label="Lifecycle"
          value={
            ann.published_at
              ? "Published"
              : ann.scheduled_publish_at
                ? "Scheduled"
                : "Draft"
          }
          hint={
            ann.published_at
              ? formatWat(ann.published_at, "yyyy-MM-dd HH:mm")
              : ann.scheduled_publish_at
                ? formatWat(ann.scheduled_publish_at, "yyyy-MM-dd HH:mm")
                : "Not yet sent"
          }
          tone={ann.published_at ? "signal" : ann.scheduled_publish_at ? "amber" : "muted"}
        />
        <StatusCard
          label="Delivery"
          value={`${read} / ${total} read`}
          hint={total === 0 ? "No recipients yet" : `${pct}% open rate`}
          tone={total > 0 && pct > 0 ? "signal" : "muted"}
        />
        <StatusCard
          label="Priority"
          value={ann.priority}
          hint="How loudly this notifies"
          tone={
            ann.priority === "urgent"
              ? "flare"
              : ann.priority === "important"
                ? "amber"
                : "neutral"
          }
        />
      </div>

      <article
        className="cade-prose rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {/* Plain-text summary preserved for E2E assertion */}
      <p className="text-xs text-[var(--chalk-3)]">
        Delivery: {read} / {total} read
      </p>

      {!ann.published_at ? (
        <form
          action={publishNowFromDetail}
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--signal)]">
            Ship it
          </div>
          <p className="mt-1 text-xs text-[var(--chalk-3)]">
            Publish immediately. Recipients get in-app + email per the
            audience + channel settings.
          </p>
          <input type="hidden" name="id" value={ann.id} />
          <div className="mt-4">
            <PrimaryButton type="submit">Publish now</PrimaryButton>
          </div>
        </form>
      ) : (
        <form
          action={unpublishFromDetail}
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--flare)]">
            Retract
          </div>
          <p className="mt-1 text-xs text-[var(--chalk-3)]">
            Pull this briefing back to draft. Already-delivered
            notifications stay in recipient inboxes — only the public
            list + future fan-out are affected.
          </p>
          <input type="hidden" name="id" value={ann.id} />
          <div className="mt-4">
            <DangerButton
              type="submit"
              data-testid="unpublish-announcement-btn"
            >
              Unpublish
            </DangerButton>
          </div>
        </form>
      )}
    </div>
  );
}

function StatusCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "signal" | "amber" | "flare" | "neutral" | "muted";
}) {
  const color =
    tone === "signal"
      ? "text-[var(--signal)]"
      : tone === "amber"
        ? "text-[var(--amber)]"
        : tone === "flare"
          ? "text-[var(--flare)]"
          : tone === "muted"
            ? "text-[var(--chalk-2)]"
            : "text-[var(--chalk-0)]";
  const bar =
    tone === "signal"
      ? "bg-[var(--signal)]"
      : tone === "amber"
        ? "bg-[var(--amber)]"
        : tone === "flare"
          ? "bg-[var(--flare)]"
          : "bg-[var(--ink-4)]";
  return (
    <div className="relative overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--chalk-3)]">
        {label}
      </div>
      <div
        className={
          "mt-1 font-display text-xl font-bold capitalize " + color
        }
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-[var(--chalk-3)]">{hint}</div>
      <span
        aria-hidden
        className={"absolute inset-x-0 bottom-0 h-[2px] " + bar}
      />
    </div>
  );
}
