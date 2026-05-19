import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync, requirePermAsync } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  DangerButton,
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
import {
  getLockoutInfo,
  LOCKOUT_THRESHOLD,
} from "@/server/auth/sessions";
import { unlockPlayerAccountAction, updatePlayerAction } from "../../actions";

export const dynamic = "force-dynamic";

async function resolveAdmin(): Promise<{
  sb: ReturnType<typeof getServiceRoleSupabase>;
  canUnlock: boolean;
  publicUserId: string;
}> {
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
  // Bug 11 fix — gate the inline "Unlock account" button on
  // `users.unlock` (admin / loc / idc). users.edit is sufficient to view
  // the page; users.unlock is required to actually clear the lockout.
  const canUnlock = await hasPermAsync(
    sb,
    { userId: pub.id, roles },
    "users.unlock",
  );
  return { sb, canUnlock, publicUserId: pub.id };
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
  searchParams: Promise<{ saved?: string; unlocked?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, canUnlock } = await resolveAdmin();

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

  // Bug 11 — fetch the live lockout state for this player's email so
  // we can render either an "Account locked" warning + Unlock button
  // OR a passive "N attempts in last window" hint. Service-role read
  // dodges the RLS deny-all on auth_events.
  const lockInfo = await getLockoutInfo(sb, p.users.email);
  const lockMinutesRemaining = Math.max(
    1,
    Math.ceil(lockInfo.msRemaining / 60_000),
  );

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

      {sp.unlocked ? (
        <div className="rounded-sm border border-[var(--primary)] bg-[rgba(107,205,6,0.08)] p-3 text-xs text-[var(--primary)]">
          Account unlocked · the player can sign in immediately.
        </div>
      ) : null}

      {/*
        Bug 11 fix — surface the lockout state so an admin/LOC/IDC sees
        WHY a player is reporting "wrong password" before the page
        prompts them to actually unlock. Three states:
          • locked → red badge + Unlock button (gated on users.unlock)
          • approaching → orange "warning" badge (3+ attempts in window)
          • clear → no banner at all
      */}
      {lockInfo.locked ? (
        <div
          className="flex flex-wrap items-start gap-3 rounded-sm border p-3 text-xs"
          style={{
            borderColor: "rgba(255,91,59,0.45)",
            background: "rgba(255,91,59,0.08)",
            color: "var(--flare)",
          }}
        >
          <div className="flex-1 min-w-[240px] space-y-1">
            <div className="font-semibold uppercase tracking-[0.18em]">
              Account locked
            </div>
            <div className="text-[var(--chalk-1)]">
              {lockInfo.attemptsInWindow} failed sign-in attempts in the
              last 5 minutes. Auto-unlock in ~{lockMinutesRemaining}{" "}
              {lockMinutesRemaining === 1 ? "minute" : "minutes"}, or
              clear it now if the player is on the phone.
            </div>
          </div>
          {canUnlock ? (
            <form action={unlockPlayerAccountAction}>
              <input type="hidden" name="playerId" value={p.id} />
              <DangerButton type="submit">Unlock account</DangerButton>
            </form>
          ) : (
            <span className="text-[var(--chalk-3)]">
              users.unlock perm required
            </span>
          )}
        </div>
      ) : lockInfo.attemptsInWindow >= 3 ? (
        <div
          className="rounded-sm border p-3 text-xs"
          style={{
            borderColor: "rgba(245,158,11,0.45)",
            background: "rgba(245,158,11,0.08)",
            color: "#f59e0b",
          }}
        >
          {lockInfo.attemptsInWindow} of {LOCKOUT_THRESHOLD + 1} failed
          sign-in attempts in the last 5 minutes. Auto-locks on the next
          failure.
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

          <FormField
            label="Photo URL"
            hint="Public URL (https://…) or site-relative path (/brand/players/…)"
          >
            {/*
              type="text" not "url" — `<input type="url">` blocks site-
              relative paths like `/brand/players/adefola.png`, which is
              the canonical format for in-repo player photos. The server
              schema in ../../actions.ts permits both shapes; the native
              URL validator does not. Submit was silently failing for
              every existing player row before this change (2026-05-19).
            */}
            <input
              type="text"
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
