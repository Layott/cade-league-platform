import { redirect } from "next/navigation";

/**
 * Plan 52 — legacy `/admin/broadcast/[sessionId]` route. The canonical
 * control room is `/admin/broadcast/v2/[sessionId]` (the v2 panel shipped
 * in Plan 51). Anything still pointing here (stale bookmarks, deep
 * links, `revalidatePath('/admin/broadcast/<id>')` reload triggers) gets
 * bounced forward.
 *
 * Subcomponents that historically lived in this folder
 * (`EditableTemplatePanel`, `MatchControlPanel`, `MatchClockPanel`,
 * `YouTubeChatPanel`, `PreviewIframeModal`, the `forms/` folder, plus
 * the `starter-payloads.*` pair) are now orphaned reads — kept on disk
 * so `apps/web/src/app/admin/broadcast/stingers/page.tsx` can continue to
 * import `../[sessionId]/starter-payloads`. They are not exercised by
 * any user-facing route after this redirect lands.
 */

export const dynamic = "force-dynamic";

export default async function BroadcastSessionRedirect({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  redirect(`/admin/broadcast/v2/${sessionId}`);
}
