import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  PrimaryButton,
  SecondaryButton,
  DangerButton,
} from "@/components/admin/buttons";
import { FormField, inputClass } from "@/components/admin/FormField";
import { StatusPill } from "@/components/admin/StatusPill";
import { listChannels } from "@/server/youtube/channels";
import {
  createChannelAction,
  deleteChannelAction,
  promoteChannelAction,
} from "./actions";

export const dynamic = "force-dynamic";

async function resolveAdmin() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/youtube-channels");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/youtube-channels");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(
      sb,
      { userId: pub.id, roles },
      "branding.manage",
    );
  } catch (err) {
    if (err instanceof PermissionError) throw err;
    throw err;
  }
  return sb;
}

export default async function YouTubeChannelsPage() {
  const sb = await resolveAdmin();
  const channels = await listChannels(sb);

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Site Manager"
        title="YouTube channels"
        description="Channels the live-chat picker polls. The default channel is used by /api/youtube/live when callers don't specify one."
      />

      <section className="space-y-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Registered channels
        </h2>
        {channels.length === 0 ? (
          <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-8 text-center text-xs text-[var(--chalk-3)]">
            No channels registered. Add one below to enable the live-chat picker.
          </div>
        ) : (
          <div className="overflow-hidden rounded-sm border border-[var(--ink-4)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ink-2)] text-left text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
                <tr>
                  <th className="px-4 py-2">Handle</th>
                  <th className="px-4 py-2">Label</th>
                  <th className="px-4 py-2">Default</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ink-4)] bg-[var(--ink-1)]">
                {channels.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <a
                        href={`https://youtube.com/${c.handle}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[var(--chalk-0)] underline-offset-4 hover:text-[var(--signal)] hover:underline"
                      >
                        {c.handle}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-[var(--chalk-1)]">
                      {c.displayLabel ?? (
                        <span className="text-[var(--chalk-3)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.isDefault ? (
                        <StatusPill tone="signal">Default</StatusPill>
                      ) : (
                        <form action={promoteChannelAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <button
                            type="submit"
                            className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)]"
                          >
                            Promote
                          </button>
                        </form>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <form action={deleteChannelAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <DangerButton size="sm" type="submit">
                          Remove
                        </DangerButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6">
        <h2 className="mb-4 font-display text-lg font-bold text-[var(--chalk-0)]">
          Add channel
        </h2>
        <form
          action={createChannelAction}
          className="grid gap-3 sm:grid-cols-2"
        >
          <FormField label="Handle" hint="e.g. @CadeEsports">
            <input
              name="handle"
              required
              placeholder="@CadeEsports"
              pattern="^@?[A-Za-z0-9_.-]+$"
              className={inputClass}
            />
          </FormField>
          <FormField label="Display label">
            <input
              name="displayLabel"
              placeholder="CADE Esports"
              className={inputClass}
            />
          </FormField>
          <label className="flex items-center gap-2 text-xs text-[var(--chalk-1)] sm:col-span-2">
            <input type="checkbox" name="isDefault" />
            <span>
              Make default (clears any existing default; used when callers
              don&apos;t specify a channel)
            </span>
          </label>
          <div className="sm:col-span-2 flex gap-2">
            <PrimaryButton type="submit">Add channel</PrimaryButton>
            <a href="/admin/youtube-channels">
              <SecondaryButton type="button">Reset</SecondaryButton>
            </a>
          </div>
        </form>
      </section>
    </div>
  );
}
