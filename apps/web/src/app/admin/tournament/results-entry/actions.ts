"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync, PermissionError } from "@/lib/perms-db";
import { getActiveSeason } from "@/server/seasons";
import { enterResult, editResult } from "@/server/matches/results";
import { publishStandingsChanged } from "@/server/standings/realtime";

/**
 * Plan 51 — server action backing the Results Entry tab.
 *
 * Resolves the active actor, gates on `tournament.score_entry`, then either
 * INSERTs a new `match_results` row (no prior result) or UPDATEs the
 * existing draft (prior result, not yet confirmed). The Plan 11 trigger on
 * match_results recomputes standings + publishes the in-DB
 * `standings.changed` event; we still call `publishStandingsChanged` here
 * as a belt-and-braces no-op so test environments without trigger active
 * still observe the event.
 */

const submitSchema = z.object({
  matchId: z.string().uuid(),
  homeScore: z.coerce.number().int().min(0).max(99),
  awayScore: z.coerce.number().int().min(0).max(99),
  resultType: z.enum(["normal", "forfeit"]).default("normal"),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type SubmitMatchResultState =
  | { status: "idle" }
  | { status: "ok"; matchId: string; resultId: string }
  | { status: "error"; error: string };

export async function submitMatchResultAction(
  _prev: SubmitMatchResultState,
  formData: FormData,
): Promise<SubmitMatchResultState> {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/tournament/results-entry");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/tournament/results-entry");

  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const svc = getServiceRoleSupabase();
  try {
    const ok = await hasPermAsync(
      svc,
      { userId: pub.id, roles },
      "tournament.score_entry",
    );
    if (!ok) throw new PermissionError("missing tournament.score_entry");
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : "perm" };
  }

  let parsed: z.infer<typeof submitSchema>;
  try {
    parsed = submitSchema.parse({
      matchId: formData.get("matchId"),
      homeScore: formData.get("homeScore"),
      awayScore: formData.get("awayScore"),
      resultType: formData.get("resultType") ?? "normal",
      notes: formData.get("notes"),
    });
  } catch (e) {
    return {
      status: "error",
      error: e instanceof z.ZodError ? e.issues[0]?.message ?? "Invalid input" : "Invalid input",
    };
  }

  // Look up an existing result to decide enter vs edit.
  const { data: existing } = await svc
    .from("match_results")
    .select("id")
    .eq("match_id", parsed.matchId)
    .is("deleted_at", null)
    .maybeSingle();

  let resultId: string;
  try {
    if (existing) {
      const out = await editResult(svc, {
        matchId: parsed.matchId,
        homeScore: parsed.homeScore,
        awayScore: parsed.awayScore,
        resultType: parsed.resultType,
        notes: parsed.notes ?? undefined,
      });
      resultId = out.id;
    } else {
      const out = await enterResult(
        svc,
        {
          matchId: parsed.matchId,
          homeScore: parsed.homeScore,
          awayScore: parsed.awayScore,
          resultType: parsed.resultType,
          notes: parsed.notes ?? undefined,
        },
        pub.id,
      );
      resultId = out.id;
    }
  } catch (e) {
    return {
      status: "error",
      error: e instanceof Error ? e.message : "Score submit failed",
    };
  }

  // Best-effort Realtime ping (the DB trigger will also fire one).
  try {
    const season = await getActiveSeason(svc);
    if (season) await publishStandingsChanged(svc, season.id);
  } catch {
    /* ignore — DB trigger is the authority */
  }

  revalidatePath("/admin/tournament/results-entry");
  revalidatePath("/admin/tournament/standings");
  revalidatePath("/admin/tournament/fixtures");

  return { status: "ok", matchId: parsed.matchId, resultId };
}
