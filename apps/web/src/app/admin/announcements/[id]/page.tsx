import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { renderMarkdownToSafeHtml } from "@/server/announcements/render";
import { publishNowFromDetail } from "./actions";

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
      "id, title, body_md, priority, audience_type, audience_role, channels, scheduled_publish_at, published_at, is_public"
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

  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-2xl font-bold">{ann.title}</h2>
      <div className="text-sm text-gray-600">
        Priority: {ann.priority} · Audience: {ann.audience_type}
        {ann.audience_role ? ` (${ann.audience_role})` : ""} · Public:{" "}
        {ann.is_public ? "yes" : "no"}
      </div>
      <div className="text-sm">
        {ann.published_at ? (
          <>Published {formatWat(ann.published_at, "yyyy-MM-dd HH:mm")}</>
        ) : ann.scheduled_publish_at ? (
          <>Scheduled for {formatWat(ann.scheduled_publish_at, "yyyy-MM-dd HH:mm")}</>
        ) : (
          <>Draft</>
        )}
      </div>
      <article className="prose prose-sm" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="text-sm text-gray-600">
        Delivery: {readCount ?? 0} / {totalCount ?? 0} read
      </div>
      {!ann.published_at ? (
        <form action={publishNowFromDetail}>
          <input type="hidden" name="id" value={ann.id} />
          <button className="bg-black text-white rounded px-4 py-2" type="submit">
            Publish now
          </button>
        </form>
      ) : null}
    </div>
  );
}
