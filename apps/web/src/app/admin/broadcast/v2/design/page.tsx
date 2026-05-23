import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import OverlayDesignEditor, {
  type CatalogEntry,
  type TextElementRow,
  type PartnerStripLayoutRow,
  type PartnerLogoRow,
  type PartnerLogoOverrideRow,
  type AnimationRow,
} from "@/components/admin/OverlayDesignEditor";
import { PlayerPhotoPanel } from "@/components/admin/broadcast/PlayerPhotoPanel";
import { resolveTokens } from "@/server/overlays/design/tokens";
import { listTemplates } from "@/server/overlays/design/templates";
import { listHistory } from "@/server/overlays/design/history";
import { listTextElements } from "@/server/overlays/text/elements";
import { getStripLayout } from "@/server/overlays/partners/strip";
import {
  listPartnerLogos,
  getOverrides,
} from "@/server/overlays/partners/logos";
import { listAnimations } from "@/server/overlays/animations/elements";
import {
  OVERLAY_KEYS,
  TOKEN_CATALOG,
  FONT_VALUES,
  PATTERN_VALUES,
} from "@/server/overlays/design/defaults";
import { formatWat } from "@/lib/time";
import {
  setActiveTemplateAction,
  revertToSnapshotAction,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * Phase 3 — `/admin/broadcast/v2/design`.
 *
 * Single page that lets a producer / designer / admin pick an overlay
 * key + variant, edit its design tokens (color / font / scale /
 * position / partner-strip), preview the result live in an iframe, and
 * review / revert the version history. Save persists to
 * `overlay_design_tokens`; the SSR overlay route reads the merged map
 * on the next paint.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-system.md §5.1
 */

async function resolveAdmin() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/broadcast/v2/design");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/broadcast/v2/design");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(
      sb,
      { userId: pub.id, roles },
      "broadcast.v2.read",
    );
  } catch (err) {
    if (err instanceof PermissionError) throw err;
    throw err;
  }
  return { sb, userId: pub.id, roles };
}

type SearchParams = {
  overlay?: string;
  variant?: string;
};

export default async function OverlayDesignPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { sb } = await resolveAdmin();
  const sp = await searchParams;

  const selectedOverlay = OVERLAY_KEYS.includes(
    (sp.overlay ?? OVERLAY_KEYS[0]) as (typeof OVERLAY_KEYS)[number],
  )
    ? (sp.overlay ?? OVERLAY_KEYS[0])
    : OVERLAY_KEYS[0];

  // Variant list for picker + gallery. Falls back to a synthetic
  // 'default' row if the table is unreachable (e.g. fresh schema with
  // unseeded variant table).
  // 2026-05-23 — wrap the three unguarded server calls (listTemplates,
  // resolveTokens, listHistory) in try/catch with structured logging
  // so an intermittent DB failure on any one of them no longer bubbles
  // up as a "Server Components render" prod error. The fallbacks let
  // the editor still load with safe defaults; admin can retry the
  // save once the underlying issue clears.
  const variants = await listTemplates(sb, selectedOverlay).catch((err) => {
    console.error(
      `[design/page] listTemplates(${selectedOverlay}) failed:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  });
  const fallbackVariant = {
    id: "synthetic-default",
    overlayKey: selectedOverlay,
    variantId: "default",
    label: "Default",
    description: null,
    htmlPath: `apps/web/public/overlays/v2/${selectedOverlay}/index.html`,
    thumbnailPath: null,
    active: true,
  };
  const variantList = variants.length > 0 ? variants : [fallbackVariant];

  const selectedVariantId =
    variantList.find((v) => v.variantId === sp.variant)?.variantId ??
    variantList.find((v) => v.active)?.variantId ??
    variantList[0].variantId;

  const tokens = await resolveTokens(sb, selectedOverlay, selectedVariantId).catch(
    (err) => {
      console.error(
        `[design/page] resolveTokens(${selectedOverlay}/${selectedVariantId}) failed:`,
        err instanceof Error ? err.message : err,
      );
      return {} as Record<string, string>;
    },
  );
  const history = await listHistory(
    sb,
    selectedOverlay,
    selectedVariantId,
    50,
  ).catch((err) => {
    console.error(
      `[design/page] listHistory(${selectedOverlay}/${selectedVariantId}) failed:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  });
  // Wave 2 Stage 2 — text-element catalog for the new Text panel.
  const textRowsRaw = await listTextElements(
    sb,
    selectedOverlay,
    selectedVariantId,
  ).catch(() => []);
  const textElements: TextElementRow[] = textRowsRaw.map((r) => ({
    elementId: r.elementId,
    origin: r.origin,
    kind: r.kind,
    displayLabel: r.displayLabel ?? null,
    visible: r.visible,
    content: r.content,
    fontFamily: r.fontFamily,
    fontWeight: r.fontWeight,
    fontSizePx: r.fontSizePx,
    letterSpacing: r.letterSpacing,
    lineHeight: r.lineHeight,
    color: r.color,
    alignment: r.alignment,
    opacityPct: r.opacityPct,
    positionXPx: r.positionXPx,
    positionYPx: r.positionYPx,
    widthPx: r.widthPx,
    heightPx: r.heightPx,
    zIndex: r.zIndex,
  }));

  // Wave 2 Stage 3 — partner-strip layout + logo roster + per-overlay
  // overrides for the new Partners panel. All three resolve to empty /
  // null when the DB has no rows so the editor uses defaults.
  const stripRow = await getStripLayout(
    sb,
    selectedOverlay,
    selectedVariantId,
  ).catch(() => null);
  const stripLayout: PartnerStripLayoutRow | null = stripRow
    ? {
        visible: stripRow.visible,
        positionXPx: stripRow.positionXPx,
        positionYPx: stripRow.positionYPx,
        anchor: stripRow.anchor,
        orientation: stripRow.orientation,
        scalePct: stripRow.scalePct,
        itemSpacingPx: stripRow.itemSpacingPx,
        justification: stripRow.justification,
        zIndex: stripRow.zIndex,
      }
    : null;
  const partnerLogos: PartnerLogoRow[] = (await listPartnerLogos(sb).catch(
    () => [],
  )).map((l) => ({
    partnerKey: l.partnerKey,
    label: l.label,
    alt: l.alt,
    displayLabel: l.displayLabel ?? null,
    fileUrl: l.fileUrl,
    sortOrder: l.sortOrder,
    dimensionWPx: l.dimensionWPx,
    dimensionHPx: l.dimensionHPx,
  }));
  const logoOverrides: PartnerLogoOverrideRow[] = (await getOverrides(
    sb,
    selectedOverlay,
    selectedVariantId,
  ).catch(() => [])).map((o) => ({
    partnerKey: o.partnerKey,
    visible: o.visible,
    sortOverride: o.sortOverride,
  }));

  // Wave 2 Stage 4 — animatable elements + initial animation rows for
  // the new Animations panel. The element list is the union of:
  //   - text-element seed rows (every text element registered for this
  //     overlay+variant — even ones with no overrides yet);
  //   - partners-strip (the partner-strip container always animates as
  //     a single unit);
  //   - bg-image (when supported by the overlay).
  // The Animations panel filters the list further if needed but seeds
  // disabled rows for every (element_id, phase) so the toggle UI is
  // always reachable.
  const animatableElements = [
    ...textElements.map((t) => ({
      elementId: t.elementId,
      kind: t.kind,
      displayLabel: t.displayLabel ?? null,
    })),
    {
      elementId: "partners-strip",
      kind: "partner-strip-container",
      displayLabel: "Partners Strip",
    },
  ];
  const animationRows: AnimationRow[] = (
    await listAnimations(sb, selectedOverlay, selectedVariantId).catch(() => [])
  ).map((a) => ({
    elementId: a.elementId,
    animPhase: a.animPhase,
    enabled: a.enabled,
    animType: a.animType,
    durationMs: a.durationMs,
    delayMs: a.delayMs,
    easing: a.easing,
    iterationCount: a.iterationCount,
    customCssKeyframes: a.customCssKeyframes,
  }));

  const catalog: CatalogEntry[] = TOKEN_CATALOG.map((c) => ({
    tokenKey: c.tokenKey,
    tokenType: c.tokenType,
    label: c.label,
    description: c.description,
  }));

  return (
    <div className="space-y-8" data-testid="broadcast-v2-design">
      <SectionHeader
        eyebrow="Broadcast"
        title="Overlay design"
        description="Tune colors, fonts, scale, and partner-strip toggles per overlay. Edits land as CSS variables on the SSR overlay route — OBS browser sources reflect the change without a redeploy."
      />

      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-4 py-3 text-sm">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Need a brand-new overlay?
        </span>
        <Link
          href="/admin/broadcast/v2/builder"
          className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)]"
        >
          Open Overlay Builder →
        </Link>
        <span className="text-xs text-[var(--chalk-3)]">
          Compose new overlays from scratch (PSD → scene tree → keyframes → publish).
        </span>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
      >
        <div className="min-w-[220px] flex-1">
          <label
            htmlFor="overlay"
            className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]"
          >
            Overlay
          </label>
          <select
            id="overlay"
            name="overlay"
            defaultValue={selectedOverlay}
            data-testid="overlay-picker"
            className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-sm text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
          >
            {OVERLAY_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[180px] flex-1">
          <label
            htmlFor="variant"
            className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]"
          >
            Variant
          </label>
          <select
            id="variant"
            name="variant"
            defaultValue={selectedVariantId}
            data-testid="variant-picker"
            className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-sm text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
          >
            {variantList.map((v) => (
              <option key={v.variantId} value={v.variantId}>
                {v.label}
                {v.active ? " (active)" : ""}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)]"
        >
          Select
        </button>
      </form>

      <OverlayDesignEditor
        overlayKey={selectedOverlay}
        variantId={selectedVariantId}
        initialTokens={tokens}
        catalog={catalog}
        fontOptions={FONT_VALUES}
        patternOptions={PATTERN_VALUES}
        initialTextElements={textElements}
        initialStripLayout={stripLayout}
        initialPartnerLogos={partnerLogos}
        initialLogoOverrides={logoOverrides}
        animatableElements={animatableElements}
        initialAnimations={animationRows}
      />

      <section className="space-y-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
          Templates · {selectedOverlay}
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {variantList.map((v) => {
            const isActive = v.active && v.id !== "synthetic-default";
            return (
              <div
                key={v.id}
                data-testid={`template-card-${v.variantId}`}
                className={
                  "flex flex-col gap-2 rounded-sm border bg-[var(--ink-2)] p-4 " +
                  (isActive
                    ? "border-[var(--primary)] shadow-[0_0_0_1px_rgba(107,205,6,0.25)]"
                    : "border-[var(--ink-4)]")
                }
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display text-base text-[var(--chalk-0)]">
                      {v.label}
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                      {v.variantId}
                    </div>
                  </div>
                  {isActive ? (
                    <span className="rounded-sm border border-[var(--primary)] bg-[rgba(107,205,6,0.12)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--signal)]">
                      Active
                    </span>
                  ) : null}
                </div>
                {v.description ? (
                  <p className="text-xs text-[var(--chalk-2)]">{v.description}</p>
                ) : null}
                <div className="mt-2 flex gap-2">
                  <Link
                    href={`/admin/broadcast/v2/design?overlay=${selectedOverlay}&variant=${v.variantId}`}
                    className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
                  >
                    Edit
                  </Link>
                  {!isActive && v.id !== "synthetic-default" ? (
                    <form action={setActiveTemplateAction}>
                      <input
                        type="hidden"
                        name="overlayKey"
                        value={selectedOverlay}
                      />
                      <input
                        type="hidden"
                        name="variantId"
                        value={v.variantId}
                      />
                      <PrimaryButton size="sm" type="submit">
                        Set active
                      </PrimaryButton>
                    </form>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
          Version history · last {history.length}
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-[var(--chalk-3)]">
            No changes recorded yet for this variant.
          </p>
        ) : (
          <ol className="space-y-2" data-testid="history-list">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex flex-col gap-1 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="text-xs font-mono text-[var(--chalk-0)]">
                    {formatWat(h.createdAt, "MMM d HH:mm")}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                    {h.reason ?? "—"}
                  </div>
                </div>
                <form action={revertToSnapshotAction}>
                  <input type="hidden" name="snapshotId" value={h.id} />
                  <input
                    type="hidden"
                    name="overlayKey"
                    value={selectedOverlay}
                  />
                  <SecondaryButton size="sm" type="submit">
                    Revert
                  </SecondaryButton>
                </form>
              </li>
            ))}
          </ol>
        )}
      </section>

      <PlayerPhotoPanel />
    </div>
  );
}
