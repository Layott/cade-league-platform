"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { recordLogin } from "@/server/auth/sessions";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/admin");

  const sb = await getServerSupabase();
  const { error, data } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    await sb.from("auth_events").insert({
      user_id: null,
      event_type: "login_failed",
      metadata: { email, reason: error?.message ?? "unknown" },
    });
    redirect(`/login?error=${encodeURIComponent("Invalid email or password")}`);
  }

  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", data.user.id)
    .single();
  if (!pub) {
    redirect(`/login?error=${encodeURIComponent("Account not provisioned")}`);
  }

  const h = await headers();
  await recordLogin(sb, {
    publicUserId: pub.id,
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0",
    userAgent: h.get("user-agent") ?? "",
    acceptLanguage: h.get("accept-language") ?? "",
  });

  redirect(next);
}
