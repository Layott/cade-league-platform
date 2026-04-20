import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { renderMarkdownToSafeHtml } from "@/server/announcements/render";

/** Shift markdown heading levels down by one so the page's PageHeader
 * remains the sole h1. h1→h2, h2→h3, h3→h4. Sanitized HTML only. */
function shiftHeadings(html: string): string {
  return html
    .replace(/<h3(\s[^>]*)?>/gi, "<h4$1>")
    .replace(/<\/h3>/gi, "</h4>")
    .replace(/<h2(\s[^>]*)?>/gi, "<h3$1>")
    .replace(/<\/h2>/gi, "</h3>")
    .replace(/<h1(\s[^>]*)?>/gi, "<h2$1>")
    .replace(/<\/h1>/gi, "</h2>");
}
import { PageHeader } from "@/components/public/PageHeader";
import { EmptyState } from "@/components/public/EmptyState";

export const revalidate = 60;

export const metadata = { title: "News" };

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

function toneOf(priority: Priority) {
  return PRIORITY_TONES[priority] ?? PRIORITY_TONES.info;
}

export default async function PublicAnnouncements() {
  const sb = await getServerSupabase();
  const { data: rows } = await sb
    .from("announcements")
    .select("id, title, body_md, priority, published_at")
    .is("deleted_at", null)
    .eq("is_public", true)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(50);

  const items = rows ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="From the studio"
        title="League News"
        description="Official announcements, fixture releases, rule clarifications, and discipline updates from the CADE League office."
      />

      <div className="mx-auto max-w-4xl px-5 py-10">
        {items.length === 0 ? (
          <EmptyState
            title="The studio is quiet — for now"
            hint="Public announcements from the league office will surface here the moment they go live."
          />
        ) : (
          <ul className="space-y-6">
            {items.map((r) => {
              const tone = toneOf(r.priority);
              return (
                <li key={r.id}>
                  <article className="relative overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] transition-colors hover:border-[var(--signal)]">
                    <div aria-hidden className={"h-1 w-full " + tone.bar} />
                    <div className="p-6 md:p-7">
                      <header className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <span
                            className={
                              "inline-flex items-center rounded-sm px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] " +
                              tone.bg +
                              " " +
                              tone.text
                            }
                          >
                            {tone.label}
                          </span>
                          <time
                            dateTime={r.published_at ?? ""}
                            className="tabular text-[11px] uppercase tracking-[0.2em] text-[var(--chalk-3)]"
                          >
                            {r.published_at
                              ? formatWat(
                                  r.published_at,
                                  "EEE dd MMM yyyy · HH:mm",
                                ) + " WAT"
                              : ""}
                          </time>
                        </div>
                      </header>
                      <h2 className="mt-4 font-display text-2xl font-bold leading-tight tracking-tight text-[var(--chalk-0)] md:text-3xl">
                        {r.title}
                      </h2>
                      <div
                        className="cade-prose mt-4 text-[15px] leading-relaxed"
                        dangerouslySetInnerHTML={{
                          __html: shiftHeadings(
                            renderMarkdownToSafeHtml(r.body_md),
                          ),
                        }}
                      />
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
