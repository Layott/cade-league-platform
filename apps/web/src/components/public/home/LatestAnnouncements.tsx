import Link from "next/link";
import { formatWat } from "@/lib/time";
import { EmptyState } from "@/components/public/EmptyState";
import { renderMarkdownToSafeHtml } from "@/lib/markdown";
import type { HomeAnnouncement } from "@/server/homepage";

type Priority = "info" | "important" | "urgent" | string;

const PRIORITY_TONES: Record<
  string,
  { label: string; bg: string; text: string; bar: string }
> = {
  urgent: {
    label: "Urgent",
    bg: "bg-[var(--flare)]/15",
    text: "text-[var(--flare)]",
    bar: "bg-[var(--flare)]",
  },
  important: {
    label: "Important",
    bg: "bg-[var(--amber)]/15",
    text: "text-[var(--amber)]",
    bar: "bg-[var(--amber)]",
  },
  info: {
    label: "News",
    bg: "bg-[var(--signal)]/12",
    text: "text-[var(--signal)]",
    bar: "bg-[var(--signal)]",
  },
};

function tone(priority: Priority) {
  return PRIORITY_TONES[priority] ?? PRIORITY_TONES.info;
}

/** Trim a rendered HTML string to the first N characters of *text*, then
 * return the HTML up to that point (best-effort preview). We flatten to a
 * single <p> so the homepage never renders stray h1/h2 from markdown. */
function firstParagraphHtml(md: string): string {
  const html = renderMarkdownToSafeHtml(md);
  const text = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const preview = text.length <= 220 ? text : text.slice(0, 220).trim() + "…";
  return `<p>${preview}</p>`;
}

export function LatestAnnouncements({
  items,
}: {
  items: HomeAnnouncement[];
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No news out of the studio yet"
        hint="League announcements, fixture releases, and rule clarifications will post here."
      />
    );
  }

  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {items.map((a) => {
        const t = tone(a.priority);
        return (
          <li key={a.id}>
            <article className="group relative flex h-full flex-col overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] transition-colors hover:border-[var(--signal)]">
              <div aria-hidden className={"h-1 w-full " + t.bar} />
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={
                      "inline-flex items-center rounded-sm px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] " +
                      t.bg +
                      " " +
                      t.text
                    }
                  >
                    {t.label}
                  </span>
                  <time
                    dateTime={a.published_at}
                    className="tabular text-[11px] uppercase tracking-[0.18em] text-[var(--chalk-3)]"
                  >
                    {formatWat(a.published_at, "dd MMM · HH:mm")} WAT
                  </time>
                </div>
                <h3 className="mt-3 font-display text-lg font-bold leading-tight text-[var(--chalk-0)]">
                  {a.title}
                </h3>
                <div
                  className="cade-prose mt-2 line-clamp-4 text-sm text-[var(--chalk-2)]"
                  dangerouslySetInnerHTML={{
                    __html: firstParagraphHtml(a.body_md),
                  }}
                />
                <div className="mt-auto pt-4">
                  <Link
                    href="/announcements"
                    className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-[var(--chalk-1)] transition-colors hover:text-[var(--signal)]"
                  >
                    Read briefing
                    <span
                      aria-hidden
                      className="transition-transform group-hover:translate-x-0.5"
                    >
                      →
                    </span>
                  </Link>
                </div>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
