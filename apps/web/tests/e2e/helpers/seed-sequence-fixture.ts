import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

function loadEnvFromDotEnvLocal(): void {
  const p = path.resolve(__dirname, "..", "..", "..", ".env.local");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

export function getServiceRoleClient(): SupabaseClient {
  loadEnvFromDotEnvLocal();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export type SequenceSeedResult = {
  designId: string;
  slug: string;
  sceneIds: string[];
  cleanup: () => Promise<void>;
};

export async function seedWave3aSequenceFixture(): Promise<SequenceSeedResult> {
  const sb = getServiceRoleClient();
  const slug = `vr-wave3a-${Date.now().toString(36)}`;

  const { data: design, error: dErr } = await sb
    .from("overlay_user_designs")
    .insert({
      slug,
      title: "Wave 3A Sequence VR Fixture",
      mode: "sequence",
      status: "published",
      canvas_width: 1920,
      canvas_height: 1080,
    })
    .select("id")
    .single();
  if (dErr || !design) throw dErr ?? new Error("design insert failed");

  const sceneIds: string[] = [];
  const sceneContents = [
    { text: "SCENE ONE", color: "#6bcd06" },
    { text: "SCENE TWO", color: "#fe036d" },
    { text: "SCENE THREE", color: "#ffffff" },
  ];
  for (let i = 0; i < 3; i++) {
    const { data: scene, error: sErr } = await sb
      .from("overlay_user_design_scenes")
      .insert({
        design_id: design.id,
        order_index: i,
        name: `Scene ${i + 1}`,
        duration_ms: 2000,
        transition_in: "cut",
        transition_out: "cut",
      })
      .select("id")
      .single();
    if (sErr || !scene) throw sErr ?? new Error("scene insert failed");
    sceneIds.push(scene.id);
    await sb.from("overlay_user_design_elements").insert({
      scene_id: scene.id,
      element_type: "text",
      z_index: 0,
      transform: { x: 200, y: 400, width: 1520, height: 200, rotation: 0, scale_x: 1, scale_y: 1, opacity: 1 },
      style: { fontFamily: "Agharti", fontSize: 192, fill: sceneContents[i].color, fontWeight: 700 },
      content: { text: sceneContents[i].text },
    });
  }

  return {
    designId: design.id,
    slug,
    sceneIds,
    cleanup: async () => {
      await sb.from("overlay_user_designs").delete().eq("id", design.id);
    },
  };
}
