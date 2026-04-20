import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const sb = await getServerSupabase();
  const { data } = await sb.auth.getUser();

  if (data.user) {
    const { data: pub } = await sb
      .from("users")
      .select("id")
      .eq("supabase_auth_id", data.user.id)
      .single();
    if (pub) {
      await sb.from("auth_events").insert({
        user_id: pub.id,
        event_type: "logout",
      });
    }
  }

  await sb.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
