import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ADMIN_HUBS, findHubByPath } from "@/lib/admin-nav";

/**
 * UI Audit Slice 4 (2026-04-28) — middleware now derives admin-area
 * gates from `lib/admin-nav.ts`. Each /admin/<hub>/* segment maps to
 * its hub's perm string; if the user lacks that perm we redirect to
 * /profile with an error flag. Per-page `requirePermAsync` still
 * re-validates inside each page.
 *
 * Threshold check: `/admin/*` requires an authenticated user whose
 * role set has at least ONE permission row (admin wildcard '*'
 * trivially passes). Hub-level filtering is the second layer.
 *
 * Audit P2-010 — collapses three static role sets (ADMIN_ROLES,
 * ADMIN_TOURNAMENT_ROLES, ADMIN_BROADCAST_V2_ROLES) into one
 * perm-driven check, eliminating the drift between role lists and
 * actual `role_permissions` table state.
 */

const PLAYER_AREA_ROLES = new Set([
  "admin",
  "moderator",
  "player",
  "loc",
  "referee",
]);

const REFEREE_AREA_ROLES = new Set(["admin", "moderator", "referee"]);

/**
 * Roles permitted to enter /admin/* at all. coach / team_manager / player /
 * viewer never see the admin shell — they get redirected to /profile with
 * `?error=admin_forbidden`. Per-hub perm gate (matchday.read, etc.) runs as
 * a second layer inside the staff cohort.
 *
 * Discovered 2026-05-12: previous "at-least-one-perm" threshold allowed the
 * player role through because `matches.read` is shared between the public
 * standings view and the /admin/match-days hub. Same code path on old + new
 * Vercel — pre-existing leak surfaced during migration walk-through.
 */
const ADMIN_AREA_ROLES = new Set([
  "admin",
  "loc",
  "idc",
  "referee",
  "technical",
  "production",
  "design",
  "moderator",
]);

/** Inline perm-match helper — duplicated from admin-nav.ts because the
 * Edge runtime can't pull `lib/admin-nav` at module load if it transitively
 * imports server-only Supabase code. The matchesPerm logic is small. */
function permsAllow(rules: readonly string[], action: string): boolean {
  for (const rule of rules) {
    if (rule === "*") return true;
    if (rule === action) return true;
    if (rule.endsWith(".*")) {
      const prefix = rule.slice(0, -1);
      if (action.startsWith(prefix)) return true;
    }
  }
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAdmin = pathname.startsWith("/admin");
  const isPlayerArea = pathname.startsWith("/player");
  const isRefereeArea = pathname.startsWith("/referee");
  const isOverlayV2 = pathname.startsWith("/overlay/v2");
  const isRoot = pathname === "/";

  // Plan 51 — /overlay/v2/* is public (browser-source pull, no auth).
  if (isOverlayV2) return NextResponse.next();

  if (!isAdmin && !isPlayerArea && !isRefereeArea && !isRoot)
    return NextResponse.next();

  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookies) {
          cookies.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Root route: unauthenticated visitors land on /welcome unless they
  // explicitly opted out with ?nolanding=1.
  if (isRoot) {
    if (user) return NextResponse.next();
    const nolanding = req.nextUrl.searchParams.get("nolanding");
    if (nolanding === "1") return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/welcome";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const { data: pub } = await supabase
    .from("users")
    .select("id")
    .eq("supabase_auth_id", user.id)
    .single();
  if (!pub) return NextResponse.redirect(new URL("/login", req.url));

  const { data: rolesRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);

  if (isAdmin) {
    // Threshold (1): caller must hold at least one staff-tier role.
    // coach / team_manager / player / viewer get bounced to /profile —
    // the admin shell never paints, even with `matches.read` shared
    // between public standings and the match-days hub.
    const hasStaffRole = roles.some((r) => ADMIN_AREA_ROLES.has(r));
    if (!hasStaffRole) {
      return NextResponse.redirect(
        new URL("/profile?error=admin_forbidden", req.url),
      );
    }

    // Threshold (2): staff role still needs at least one perm row to
    // pass downstream hub gates. Defensive (a misconfigured role with
    // no rows would otherwise crash inside hub resolution).
    if (roles.length === 0) {
      return NextResponse.redirect(
        new URL("/profile?error=admin_forbidden", req.url),
      );
    }

    // Resolve every effective perm rule for this user via PostgREST.
    // role_permissions is small (12 roles × handful of rows each), so a
    // single IN-list query is cheap. Edge runtime handles fetch fine.
    const { data: permRows } = await supabase
      .from("role_permissions")
      .select("role, permission")
      .in("role", roles);
    const userPerms = ((permRows ?? []) as { permission: string }[]).map(
      (r) => r.permission,
    );

    // Threshold (2): at least one perm rule.
    if (userPerms.length === 0) {
      return NextResponse.redirect(
        new URL("/profile?error=admin_forbidden", req.url),
      );
    }

    // /admin (the dashboard root) is allowed for anyone past the threshold.
    // Hub gating only kicks in for /admin/<hub>/* paths.
    const hub = findHubByPath(pathname);
    if (hub) {
      const allowed = permsAllow(userPerms, hub.perm);
      if (!allowed) {
        return NextResponse.redirect(
          new URL(
            `/profile?error=hub_forbidden&hub=${encodeURIComponent(hub.key)}`,
            req.url,
          ),
        );
      }
    }
    return res;
  }

  if (isRefereeArea) {
    const allowed = roles.some((r) => REFEREE_AREA_ROLES.has(r));
    if (!allowed) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    return res;
  }

  // /player/** — any authenticated user whose roles include player (or an
  // admin/moderator/ref impersonation path).
  const allowed = roles.some((r) => PLAYER_AREA_ROLES.has(r));
  if (!allowed) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return res;
}

export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/player/:path*",
    "/referee/:path*",
    // Plan 51 — overlay v2 routes added so future view_token validation
    // can hook into middleware.
    "/overlay/v2/:path*",
  ],
};

// Re-export ADMIN_HUBS so the hub list is "live" in the Edge bundle (allows
// future tooling to introspect hub perms without re-importing admin-nav).
export { ADMIN_HUBS };
