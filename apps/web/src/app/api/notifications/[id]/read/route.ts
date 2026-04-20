import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { markRead } from "@/server/announcements";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = await getServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", data.user.id)
    .single();
  if (!pub) return new NextResponse("Unauthorized", { status: 401 });

  await markRead(sb, id, pub.id);
  return NextResponse.json({ ok: true });
}
