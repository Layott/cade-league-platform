import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createShootSchema,
  updateShootSchema,
  type CreateShootInput,
  type UpdateShootInput,
} from "./schemas";

export class PreseasonShootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreseasonShootError";
  }
}

export type PreseasonShootRow = {
  id: string;
  season_id: string;
  shoot_date: string;
  type: "photo" | "video" | "interview";
  location: string | null;
  status: "scheduled" | "completed" | "cancelled";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export async function createShoot(
  sb: SupabaseClient,
  raw: CreateShootInput,
): Promise<PreseasonShootRow> {
  const input = createShootSchema.parse(raw);
  const { data, error } = await sb
    .from("preseason_shoots")
    .insert({
      season_id: input.seasonId,
      shoot_date: input.shootDate,
      type: input.type,
      location: input.location ?? null,
      status: input.status,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new PreseasonShootError(
      `createShoot: ${error?.message ?? "unknown"}`,
    );
  }
  return data as PreseasonShootRow;
}

export async function updateShoot(
  sb: SupabaseClient,
  raw: UpdateShootInput,
): Promise<PreseasonShootRow> {
  const input = updateShootSchema.parse(raw);
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.shootDate !== undefined) patch.shoot_date = input.shootDate;
  if (input.type !== undefined) patch.type = input.type;
  if (input.location !== undefined) patch.location = input.location;
  if (input.status !== undefined) patch.status = input.status;

  const { data, error } = await sb
    .from("preseason_shoots")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error || !data) {
    throw new PreseasonShootError(
      `updateShoot: ${error?.message ?? "unknown"}`,
    );
  }
  return data as PreseasonShootRow;
}

export async function cancelShoot(
  sb: SupabaseClient,
  shootId: string,
): Promise<PreseasonShootRow> {
  return updateShoot(sb, { id: shootId, status: "cancelled" });
}

export async function completeShoot(
  sb: SupabaseClient,
  shootId: string,
): Promise<PreseasonShootRow> {
  return updateShoot(sb, { id: shootId, status: "completed" });
}

export async function listShoots(
  sb: SupabaseClient,
  seasonId?: string,
): Promise<PreseasonShootRow[]> {
  let q = sb
    .from("preseason_shoots")
    .select("*")
    .is("deleted_at", null);
  if (seasonId) q = q.eq("season_id", seasonId);
  const { data, error } = await q.order("shoot_date", { ascending: true });
  if (error) throw new PreseasonShootError(`listShoots: ${error.message}`);
  return (data ?? []) as PreseasonShootRow[];
}

export async function getShootById(
  sb: SupabaseClient,
  shootId: string,
): Promise<PreseasonShootRow | null> {
  const { data, error } = await sb
    .from("preseason_shoots")
    .select("*")
    .eq("id", shootId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new PreseasonShootError(`getShootById: ${error.message}`);
  return (data as PreseasonShootRow | null) ?? null;
}
