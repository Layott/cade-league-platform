import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { listFonts } from "@/server/overlays/builder/fonts";
import { FontUploadForm } from "./FontUploadForm";
import { deleteFontAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * /admin/broadcast/v2/builder/fonts — custom font asset library.
 *
 * Perm-gates on `overlay.design.manage`. Lists active uploaded fonts +
 * an upload form. Soft-delete via row-level form action.
 */

async function resolveAdmin() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth?.user) redirect("/login?next=/admin/broadcast/v2/builder/fonts");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/broadcast/v2/builder/fonts");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(sb, { userId: pub.id, roles }, "overlay.design.manage");
  } catch (e) {
    if (e instanceof PermissionError) redirect("/admin");
    throw e;
  }
  return sb;
}

export default async function FontsPage() {
  const sb = await resolveAdmin();
  const fonts = await listFonts(sb);

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Custom Fonts</h1>
        <p className="text-sm text-white/60">
          Upload TTF / OTF / WOFF / WOFF2 — converts to WOFF2 server-side and
          appears in the builder font picker.
        </p>
      </header>

      <section className="rounded border border-white/10 bg-zinc-950 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">
          Upload
        </h2>
        <FontUploadForm />
      </section>

      <section className="rounded border border-white/10 bg-zinc-950 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">
          Library ({fonts.length})
        </h2>
        {fonts.length === 0 ? (
          <p className="text-sm text-white/40">No custom fonts yet.</p>
        ) : (
          <table className="w-full text-sm text-white">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-white/40">
                <th className="pb-2">Family</th>
                <th className="pb-2">Weight</th>
                <th className="pb-2">Style</th>
                <th className="pb-2">Format</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {fonts.map((f) => (
                <tr key={f.id} className="border-t border-white/5">
                  <td className="py-2">{f.family_name}</td>
                  <td className="py-2">{f.weight}</td>
                  <td className="py-2">{f.style}</td>
                  <td className="py-2 uppercase">{f.format}</td>
                  <td className="py-2 text-right">
                    <form
                      action={async () => {
                        "use server";
                        await deleteFontAction(f.id);
                      }}
                    >
                      <button
                        type="submit"
                        className="rounded border border-rose-500/40 px-3 py-1 text-xs text-rose-400 hover:bg-rose-500/10"
                      >
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
