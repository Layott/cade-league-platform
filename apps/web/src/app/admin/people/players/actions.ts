"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { clearLockoutForEmail } from "@/server/auth/sessions";

// Plan 39 sanitize — strict schema for the player-edit endpoint. Caps
// every text field so a wedge upload can't blow past the DB column
// length, and forces photoUrl through a URL parse with a scheme allow-
// list (`http`/`https` only — no `javascript:` / `data:` exfiltration
// vectors). Site-relative paths starting with `/` are also accepted
// because in-repo player photos canonically live at
// `/brand/players/<slug>.png` (see /profile/schemas.ts for the matching
// rule on the player self-edit form, 2026-05-19).
const PHOTO_URL_SCHEMES = new Set(["http:", "https:"]);
const updatePlayerSchema = z.object({
  playerId: z.string().uuid(),
  displayName: z.string().trim().max(80).optional(),
  gamerTag: z.string().trim().max(80).optional(),
  psnId: z.string().trim().max(64).nullable().optional(),
  jerseyNumber: z.number().int().min(1).max(99).nullable().optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  photoUrl: z
    .string()
    .trim()
    .max(2048)
    .nullable()
    .optional()
    .refine(
      (v) => {
        if (!v) return true;
        // Allow site-relative paths (e.g. /brand/players/adefola.png)
        // alongside absolute http(s) URLs. Reject every other shape so
        // `javascript:`/`data:` exfil vectors stay blocked.
        if (v.startsWith("/")) return !v.startsWith("//");
        try {
          const u = new URL(v);
          return PHOTO_URL_SCHEMES.has(u.protocol);
        } catch {
          return false;
        }
      },
      {
        message:
          "photoUrl must be an http(s) URL or a site-relative path starting with /",
      },
    ),
  organizationId: z.string().uuid().nullable().optional(),
  coachId: z.string().uuid().nullable().optional(),
  teamManagerId: z.string().uuid().nullable().optional(),
});

async function gate(perm: string = "users.edit"): Promise<{
  sb: ReturnType<typeof getServiceRoleSupabase>;
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
  try {
    await requirePermAsync(sb, { userId: pub.id, roles }, perm);
  } catch (e) {
    if (e instanceof PermissionError) {
      throw new Error(`Forbidden: missing ${perm}`);
    }
    throw e;
  }
  const limited = await enforceAuthedWrite(pub.id);
  if (limited) throw new Error("rate_limited");
  return { sb, publicUserId: pub.id };
}

export async function updatePlayerAction(formData: FormData) {
  const playerIdRaw = String(formData.get("playerId") ?? "");
  if (!playerIdRaw) throw new Error("playerId required");

  const jerseyRaw = String(formData.get("jerseyNumber") ?? "").trim();
  const orgRaw = String(formData.get("organizationId") ?? "").trim();
  const coachRaw = String(formData.get("coachId") ?? "").trim();
  const tmRaw = String(formData.get("teamManagerId") ?? "").trim();
  const psnRaw = String(formData.get("psnId") ?? "").trim();
  const bioRaw = String(formData.get("bio") ?? "").trim();
  const photoRaw = String(formData.get("photoUrl") ?? "").trim();
  const dnRaw = String(formData.get("displayName") ?? "").trim();
  const tagRaw = String(formData.get("gamerTag") ?? "").trim();

  // Single Zod parse covers length caps + photoUrl scheme + UUID shape.
  const parsed = updatePlayerSchema.parse({
    playerId: playerIdRaw,
    displayName: dnRaw || undefined,
    gamerTag: tagRaw || undefined,
    psnId: psnRaw || null,
    jerseyNumber: jerseyRaw ? Number(jerseyRaw) : null,
    bio: bioRaw || null,
    photoUrl: photoRaw || null,
    organizationId: orgRaw || null,
    coachId: coachRaw || null,
    teamManagerId: tmRaw || null,
  });

  const playerId = parsed.playerId;
  const displayName = parsed.displayName ?? "";
  const gamerTag = parsed.gamerTag ?? "";
  const psnId = parsed.psnId ?? null;
  const bio = parsed.bio ?? null;
  const photoUrl = parsed.photoUrl ?? null;
  const orgId = parsed.organizationId ?? null;
  const coachId = parsed.coachId ?? null;
  const teamManagerId = parsed.teamManagerId ?? null;
  const jersey = parsed.jerseyNumber ?? null;

  const { sb } = await gate();

  // Load player → user_id so we can update display_name on the users table.
  const { data: playerRow, error: pErr } = await sb
    .from("players")
    .select("user_id")
    .eq("id", playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!playerRow) throw new Error(`player ${playerId} not found`);

  const userId = (playerRow as { user_id: string }).user_id;

  // Update users.display_name if provided.
  if (displayName) {
    const { error: uErr } = await sb
      .from("users")
      .update({ display_name: displayName })
      .eq("id", userId);
    if (uErr) throw uErr;
  }

  // Update players row.
  const patch: Record<string, unknown> = {
    gamer_tag: gamerTag || null,
    psn_id: psnId,
    jersey_number: jersey,
    bio,
    photo_url: photoUrl,
    organization_id: orgId,
    coach_id: coachId,
    team_manager_id: teamManagerId,
  };
  // Drop null-keys where the caller didn't touch them — we want them
  // nulled when cleared via the form, so we keep them. But guard against
  // sending an empty gamer_tag since the schema likely requires one.
  if (!gamerTag) delete patch.gamer_tag;

  const { error: pUpdateErr } = await sb
    .from("players")
    .update(patch)
    .eq("id", playerId)
    .is("deleted_at", null);
  if (pUpdateErr) throw pUpdateErr;

  revalidatePath("/admin/people/players");
  revalidatePath(`/admin/people/players/${playerId}/edit`);
  redirect(`/admin/people/players/${playerId}/edit?saved=1`);
}

/**
 * Bug 11 fix (2026-05-01) — clear the failed-login lockout for the
 * player whose form this is submitted from. Reads the player's email
 * via the service-role client and hands off to clearLockoutForEmail
 * (sessions.ts), which deletes in-window `login_failed` rows so the
 * lockout counter drops below threshold immediately.
 *
 * Perm-gated: `users.unlock` (seeded for admin / loc / idc — see
 * migration 20260620000019_users_unlock_perm_seed.sql).
 */
const unlockSchema = z.object({
  playerId: z.string().uuid(),
});

export async function unlockPlayerAccountAction(formData: FormData) {
  const parsed = unlockSchema.parse({
    playerId: String(formData.get("playerId") ?? ""),
  });
  const { playerId } = parsed;

  const { sb } = await gate("users.unlock");

  // Look up the player's user → email through the service-role client
  // (Plan 39 C2 revoked anon SELECT on users.email).
  const { data: row, error } = await sb
    .from("players")
    .select(`user_id, users:users!players_user_id_fkey ( email )`)
    .eq("id", playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error(`player ${playerId} not found`);

  const email = ((row as unknown as { users: { email: string } }).users
    ?.email ?? "")
    .trim()
    .toLowerCase();
  if (!email) throw new Error(`player ${playerId} has no email`);

  await clearLockoutForEmail(sb, email);

  revalidatePath(`/admin/people/players/${playerId}/edit`);
  redirect(`/admin/people/players/${playerId}/edit?unlocked=1`);
}
