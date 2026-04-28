import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import {
  requestOverlayUploadUrl,
  AssetUploadError,
} from "@/server/overlays/asset_upload";

/**
 * Plan 48 — POST /api/broadcast/asset-upload-url
 *
 * Body: { kind: 'image'|'video', filename: string, bytes: number }
 * Returns { uploadUrl, token, publicUrl, storagePath } on success.
 *
 * Gated behind authenticated + `broadcast.trigger` via requestOverlayUploadUrl.
 * The caller PUTs the File directly to `uploadUrl` and persists `publicUrl`
 * into the overlay payload field.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) return new NextResponse("Unauthorized", { status: 401 });

  const { data: rolesRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);

  const limited = await enforceAuthedWrite(pub.id);
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as {
    kind?: string;
    filename?: string;
    bytes?: number;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }

  const sb = getServiceRoleSupabase();
  try {
    const result = await requestOverlayUploadUrl({
      sb,
      actor: { userId: pub.id, roles },
      kind: String(body.kind ?? ""),
      filename: String(body.filename ?? ""),
      bytes: Number(body.bytes ?? 0),
    });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (e instanceof AssetUploadError) {
      const status = e.code === "perm_denied" ? 403 : 400;
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status },
      );
    }
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
