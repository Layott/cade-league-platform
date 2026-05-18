"use server";

import { gate } from "../../assets-actions-gate";
import { listPsdAssets, listPsdLayers } from "@/server/overlays/builder/assets";

/**
 * Wave 2A — read-only server actions for the PsdPlaceDrawer.
 *
 * Still perm-gated on overlay.design.manage so non-admin sessions
 * can't browse PSD metadata.
 */

type PsdSummary = Awaited<ReturnType<typeof listPsdAssets>>[number];
type LayerSummary = Awaited<ReturnType<typeof listPsdLayers>>[number];

export type ListPsdsResponse =
  | { ok: true; psds: PsdSummary[] }
  | { ok: false; code: "forbidden" | "unknown"; error: string };

export type ListLayersResponse =
  | { ok: true; layers: LayerSummary[] }
  | { ok: false; code: "forbidden" | "unknown"; error: string };

export async function listPsdsAction(): Promise<ListPsdsResponse> {
  try {
    const { sb } = await gate();
    const psds = await listPsdAssets(sb);
    return { ok: true, psds };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/^Forbidden/.test(msg)) return { ok: false, code: "forbidden", error: msg };
    return { ok: false, code: "unknown", error: msg };
  }
}

export async function listLayersAction(parentAssetId: string): Promise<ListLayersResponse> {
  try {
    const { sb } = await gate();
    const layers = await listPsdLayers(sb, parentAssetId);
    return { ok: true, layers };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/^Forbidden/.test(msg)) return { ok: false, code: "forbidden", error: msg };
    return { ok: false, code: "unknown", error: msg };
  }
}
