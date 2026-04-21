import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  FormField,
  inputClass,
  selectClass,
} from "@/components/admin/FormField";
import { PrimaryButton } from "@/components/admin/buttons";
import { createShootAction } from "./actions";

export const dynamic = "force-dynamic";

async function resolveGate() {
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
  const svc = getServiceRoleSupabase();
  try {
    await requirePermAsync(svc, { userId: pub.id, roles }, "preseason.manage");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: preseason.manage");
    throw e;
  }
  return svc;
}

export default async function NewShootPage() {
  const sb = await resolveGate();
  const { data: season } = await sb
    .from("seasons")
    .select("id, year_range")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();

  if (!season) {
    return (
      <div className="space-y-4">
        <SectionHeader
          eyebrow="Preseason"
          title="Schedule shoot"
          description="No active season found."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={`Season ${season.year_range}`}
        title="Schedule preseason shoot"
        description="Pick the date + type. Attendance tracking happens on the detail page."
      />
      <form action={createShootAction} className="space-y-5" data-testid="shoot-new-form">
        <input type="hidden" name="seasonId" value={season.id} />
        <FormField label="Shoot date">
          <input
            type="date"
            name="shootDate"
            required
            className={inputClass}
            data-testid="shoot-date"
          />
        </FormField>
        <FormField label="Type">
          <select
            name="type"
            required
            defaultValue="photo"
            className={selectClass}
            data-testid="shoot-type"
          >
            <option value="photo">Photo</option>
            <option value="video">Video</option>
            <option value="interview">Interview</option>
          </select>
        </FormField>
        <FormField label="Location">
          <input
            type="text"
            name="location"
            maxLength={500}
            className={inputClass}
            data-testid="shoot-location"
            placeholder="e.g. Lekki studio"
          />
        </FormField>
        <PrimaryButton type="submit" data-testid="shoot-submit">
          Schedule shoot
        </PrimaryButton>
      </form>
    </div>
  );
}
