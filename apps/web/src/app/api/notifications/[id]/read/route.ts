import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { markRead } from "@/server/announcements";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // Plan 39 sanitize — UUID-validate to prevent malformed ids reaching
  // the markRead query.
  let safeId: string;
  try {
    safeId = z.string().uuid().parse(id);
  } catch {
    return new NextResponse("invalid id", { status: 400 });
  }
  const sb = await getServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", data.user.id)
    .single();
  if (!pub) return new NextResponse("Unauthorized", { status: 401 });

  const limited = await enforceAuthedWrite(pub.id);
  if (limited) return limited;

  await markRead(sb, safeId, pub.id);
  return NextResponse.json({ ok: true });
}
