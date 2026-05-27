import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";
import { getActiveSeason } from "@/server/seasons";
import { generateLeaderboardXLSX } from "@/server/exports/leaderboard_xlsx";
import { generateLeaderboardDOCX } from "@/server/exports/leaderboard_docx";
import { generateMetricsXLSX } from "@/server/exports/metrics_xlsx";
import {
  generateBundleJSON,
  generateBundleXLSX,
} from "@/server/exports/bundle";

/**
 * GET /api/tournament/export?type=leaderboard|metrics|bundle&format=xlsx|docx|json
 *
 * Streams a binary (xlsx/docx) or JSON buffer of the active season's data.
 * Gated behind `tournament.export` — admin / loc / idc / technical roles.
 *
 * Allowed combinations:
 *   - leaderboard + xlsx | docx
 *   - metrics + xlsx
 *   - bundle + xlsx | json   ← full tournament dump (organizer, sponsors,
 *                                match days, matchups, standings, walkovers,
 *                                disciplinary)
 *
 * Any other combo returns 400.
 */

export const dynamic = "force-dynamic";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const JSON_MIME = "application/json";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = (sp.get("type") ?? "leaderboard").toLowerCase();
  const format = (sp.get("format") ?? "xlsx").toLowerCase();

  if (type !== "leaderboard" && type !== "metrics" && type !== "bundle") {
    return NextResponse.json(
      { error: "type must be leaderboard, metrics, or bundle" },
      { status: 400 },
    );
  }
  if (format !== "xlsx" && format !== "docx" && format !== "json") {
    return NextResponse.json(
      { error: "format must be xlsx, docx, or json" },
      { status: 400 },
    );
  }
  if (type === "metrics" && format !== "xlsx") {
    return NextResponse.json(
      { error: "metrics export is only available as xlsx" },
      { status: 400 },
    );
  }
  if (type === "leaderboard" && format === "json") {
    return NextResponse.json(
      { error: "leaderboard export does not support json — use bundle" },
      { status: 400 },
    );
  }
  if (type === "bundle" && format === "docx") {
    return NextResponse.json(
      { error: "bundle export does not support docx — use xlsx or json" },
      { status: 400 },
    );
  }

  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const svc = getServiceRoleSupabase();
  const ok = await hasPermAsync(svc, { userId: pub.id, roles }, "tournament.export");
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const season = await getActiveSeason(svc);
  if (!season) {
    return NextResponse.json(
      { error: "No active season" },
      { status: 404 },
    );
  }

  let buf: Buffer;
  let mime: string;
  let ext: string;
  try {
    if (type === "leaderboard" && format === "xlsx") {
      buf = await generateLeaderboardXLSX(season.id, svc);
      mime = XLSX_MIME;
      ext = "xlsx";
    } else if (type === "leaderboard" && format === "docx") {
      buf = await generateLeaderboardDOCX(season.id, svc);
      mime = DOCX_MIME;
      ext = "docx";
    } else if (type === "metrics") {
      buf = await generateMetricsXLSX(season.id, svc);
      mime = XLSX_MIME;
      ext = "xlsx";
    } else if (type === "bundle" && format === "xlsx") {
      buf = await generateBundleXLSX(season.id, svc);
      mime = XLSX_MIME;
      ext = "xlsx";
    } else {
      // bundle + json
      buf = await generateBundleJSON(season.id, svc);
      mime = JSON_MIME;
      ext = "json";
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "export failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `cade-${type}-${stamp}.${ext}`;
  // Copy the Node Buffer into a fresh ArrayBuffer so BodyInit + Blob's
  // BlobPart accept it across Edge + Node runtimes. (TS rejects the
  // SharedArrayBuffer-tinted Buffer.buffer slot directly.)
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const blob = new Blob([ab], { type: mime });
  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(blob.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
