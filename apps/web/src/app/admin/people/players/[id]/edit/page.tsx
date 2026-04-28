import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  PrimaryButton,
  SecondaryButton,
} from "@/components/admin/buttons";
import {
  FormField,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/admin/FormField";
import { StatusPill } from "@/components/admin/StatusPill";
import { updatePlayerAction } from "../../actions";

export const dynamic = "force-dynamic";

async function resolveAdmin() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const sb = getServiceRoleSupabase();
  await requirePermAsync(sb, { userId: pub.id, roles }, "users.edit");
  return sb;
}

type PlayerDetail = {
  id: string;
  user_id: string;
  gamer_tag: string;
  psn_id: string | null;
  jersey_number: number | null;
  photo_url: string | null;
  bio: string | null;
  organization_id: string | null;
  coach_id: string | null;
  team_manager_id: string | null;
  users: { id: string; display_name: string; email: string };
  organizations: { id: string; name: string } | null;
};

export default async function EditPlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const sb = await resolveAdmin();

  const { data: player } = await sb
    .from("players")
    .select(
      `
        id, user_id, gamer_tag, psn_id, jersey_number, photo_url, bio,
        organization_id, coach_id, team_manager_id,
        users:users!players_user_id_fkey!inner ( id, display_name, email ),
        organizations:organization_id ( id, name )
      `,
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!player) notFound();

  const p = player as unknown as PlayerDetail;

  // Load orgs + potential coaches + team managers for dropdowns.
  const [orgsRes, coachesRes, tmsRes] = await Promise.all([
    sb
      .from("organizations")
      .select("id, name")
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(200),
    sb
      .from("users")
      .select("id, display_name, email")
      .is("deleted_at", null)
      .order("display_name", { ascending: true })
      .limit(200),
    sb
      .from("users")
      .select("id, display_name, email")
      .is("deleted_at", null)
      .order("display_name", { ascending: true })
      .limit(200),
  ]);

  const orgs = ((orgsRes.data ?? []) as Array<{ id: string; name: string }>);
  const coaches = ((coachesRes.data ?? []) as Array<{
    id: string;
    display_name: string;
    email: string;
  }>);
  const tms = ((tmsRes.data ?? []) as Array<{
    id: string;
    display_name: string;
    email: string;
  }>);

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Site Manager"
        title={p.users.display_name}
        description={`${p.users.email} · ${p.gamer_tag}`}
        action={
          <Link href="/admin/people/players">
            <SecondaryButton>← Back to roster</SecondaryButton>
          </Link>
        }
      />

      {sp.saved ? (
        <div className="rounded-sm border border-[var(--primary)] bg-[rgba(107,205,6,0.08)] p-3 text-xs text-[var(--primary)]">
          Saved · changes live immediately.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4">
          <div className="mb-3 h-56 overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]">
            {p.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.photo_url}
                alt={p.users.display_name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-[0.2em] text-[var(--chalk-3)]">
                No photo
              </div>
            )}
          </div>
          <div className="space-y-1 text-xs text-[var(--chalk-2)]">
            <div>
              Jersey:{" "}
              <span className="font-mono text-[var(--chalk-0)]">
                {p.jersey_number ?? "—"}
              </span>
            </div>
            <div>
              Org:{" "}
              {p.organizations?.name ? (
                <StatusPill tone="primary">{p.organizations.name}</StatusPill>
              ) : (
                <span className="text-[var(--chalk-3)]">—</span>
              )}
            </div>
          </div>
        </aside>

        <form action={updatePlayerAction} className="space-y-5">
          <input type="hidden" name="playerId" value={p.id} />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Display name">
              <input
                name="displayName"
                defaultValue={p.users.display_name}
                required
                className={inputClass}
              />
            </FormField>
            <FormField label="Gamer tag">
              <input
                name="gamerTag"
                defaultValue={p.gamer_tag}
                required
                className={inputClass}
              />
            </FormField>
            <FormField label="PSN ID">
              <input
                name="psnId"
                defaultValue={p.psn_id ?? ""}
                className={inputClass}
              />
            </FormField>
            <FormField label="Jersey number">
              <input
                type="number"
                min="1"
                max="99"
                name="jerseyNumber"
                defaultValue={p.jersey_number ?? ""}
                className={inputClass}
              />
            </FormField>
          </div>

          <FormField label="Photo URL" hint="Public URL — host in Storage or CDN">
            <input
              type="url"
              name="photoUrl"
              defaultValue={p.photo_url ?? ""}
              className={inputClass}
            />
          </FormField>

          <FormField label="Bio">
            <textarea
              name="bio"
              defaultValue={p.bio ?? ""}
              rows={4}
              className={textareaClass}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Organization">
              <select
                name="organizationId"
                defaultValue={p.organization_id ?? ""}
                className={selectClass}
              >
                <option value="">— None —</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Coach">
              <select
                name="coachId"
                defaultValue={p.coach_id ?? ""}
                className={selectClass}
              >
                <option value="">— None —</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Team manager">
              <select
                name="teamManagerId"
                defaultValue={p.team_manager_id ?? ""}
                className={selectClass}
              >
                <option value="">— None —</option>
                {tms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.display_name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="flex gap-3">
            <PrimaryButton type="submit">Save changes</PrimaryButton>
            <Link href="/admin/people/players">
              <SecondaryButton type="button">Cancel</SecondaryButton>
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
