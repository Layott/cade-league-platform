import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { renderMarkdownToSafeHtml } from "@/server/announcements/render";

export const revalidate = 60; // ISR — per spec §12

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

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold">Announcements</h1>
      {(rows ?? []).map((r) => (
        <article key={r.id} className="space-y-2 border-b pb-6">
          <header className="flex items-baseline gap-3">
            <h2 className="text-xl font-semibold">{r.title}</h2>
            <span className="text-xs uppercase tracking-wide text-gray-500">{r.priority}</span>
          </header>
          <time className="text-sm text-gray-500">
            {r.published_at ? formatWat(r.published_at, "yyyy-MM-dd HH:mm") : ""}
          </time>
          <div
            className="prose prose-sm"
            dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(r.body_md) }}
          />
        </article>
      ))}
      {(!rows || rows.length === 0) && (
        <p className="text-gray-500">Nothing to announce yet.</p>
      )}
    </main>
  );
}
