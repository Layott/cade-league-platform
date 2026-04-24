import Link from "next/link";
import { formatWat } from "@/lib/time";
import {
  PrimaryButton,
  SecondaryButton,
  DangerButton,
} from "@/components/admin/buttons";
import { inputClass, textareaClass } from "@/components/admin/FormField";
import {
  TEMPLATE_REGISTRY,
  type TemplateKey,
  getTemplateRoute,
} from "@/server/overlays/registry";
import type { Preset } from "@/server/overlays/presets";
import type { ActiveInstance } from "@/server/overlays/instances";
import type { SelectableMatch } from "@/server/broadcast/match_flow";
import type { UnplayedMatch } from "@/server/matches/unplayed";
import {
  triggerOverlayAction,
  triggerInstanceAction,
  clearInstanceAction,
  clearOverlayAction,
  createPresetAction,
  deletePresetAction,
  loadPresetAction,
} from "../actions";
import { STARTER_PAYLOADS } from "./starter-payloads";
import { StructuredScoreBugForm } from "./forms/StructuredScoreBugForm";
import { StructuredUpNextForm } from "./forms/StructuredUpNextForm";
import { StructuredStartingSoonForm } from "./forms/StructuredStartingSoonForm";
import { StructuredBrbForm } from "./forms/StructuredBrbForm";
import { StructuredFeaturedCommentForm } from "./forms/StructuredFeaturedCommentForm";
import { OffTriggerButton } from "@/components/broadcast/OffTriggerButton";
import { AssetUploader } from "@/components/broadcast/AssetUploader";
import { OverlayMiniPreview } from "@/components/broadcast/OverlayMiniPreview";

/**
 * Plan 37 / Plan 45 — rich panel for editable templates.
 *
 * Plan 37 originals: presets list + JSON textarea + active instances.
 * Plan 45: for a fixed set of templateKeys the JSON textarea is REPLACED
 * with a dedicated structured form. The presets list + Save-preset slots
 * stay available below via the generic JSON form (so existing presets can
 * still be loaded). Falls back to generic JSON textarea for every other
 * template.
 */

export type EditableTemplatePanelProps = {
  sessionId: string;
  templateKey: TemplateKey;
  isLive: boolean;
  presets: Preset[];
  /** For lower_third (multi-instance) — array of live slots. */
  activeInstances?: ActiveInstance[];
  /** For single-instance templates — the legacy active overlay event row. */
  activeSingle?: {
    id: string;
    payload: Record<string, unknown>;
    triggered_at: string;
  } | null;
  multiInstance: boolean;
  /** Plan 45 — extra context for the structured forms. */
  selectable?: SelectableMatch[];
  unplayed?: UnplayedMatch[];
  /** Plan 48.3 — per-session shared secret so the inline mini-preview
   *  iframe can reach unauthenticated overlay endpoints. */
  viewToken?: string | null;
  /** Plan 48.3 — templates whose payloads carry `slot: 'primary'|'secondary'`
   *  render TWO mini-previews side-by-side (primary + secondary). */
  slotCapable?: boolean;
};

/**
 * Templates that render a structured form INSTEAD of the JSON textarea.
 * Keep in sync with the form files under ./forms/. (match_clock has its
 * own standalone MatchClockPanel above this list — not an overlay template
 * so not handled here.)
 */
const STRUCTURED_KEYS = new Set<string>([
  "score_bug",
  "up_next_bug",
  "starting_soon_timer",
  "layout_brb_full",
  "featured_comment",
]);

export function EditableTemplatePanel(props: EditableTemplatePanelProps) {
  const {
    sessionId,
    templateKey,
    isLive,
    presets,
    activeInstances,
    activeSingle,
    multiInstance,
    selectable,
    unplayed,
    viewToken = null,
    slotCapable = false,
  } = props;
  const tpl = TEMPLATE_REGISTRY[templateKey as TemplateKey] ?? null;
  const starter = STARTER_PAYLOADS[templateKey] ?? {};
  const label = templateKey
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  const slots = multiInstance ? [1, 2, 3] : null;
  const slotLabels = ["bottom", "mid", "top"];
  const isStructured = STRUCTURED_KEYS.has(templateKey);

  return (
    <div
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
      data-testid={`editable-panel-${templateKey}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-display text-sm font-bold text-[var(--chalk-0)]">
            {label}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            {tpl ? tpl.route : "match_clock (no route)"}
          </div>
        </div>
        {tpl ? (
          <Link
            href={`${getTemplateRoute(templateKey as TemplateKey)}?session=${sessionId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
          >
            Preview ↗
          </Link>
        ) : null}
      </div>

      {/* Plan 48.3 — inline mini-preview(s) mounted WITH the controls.
          Producer sees entry / exit / score edits the moment the button
          fires. Slot-capable templates render both primary + secondary
          side-by-side; everything else renders a single tile. */}
      {tpl ? (
        <div
          className="mb-4 flex flex-wrap items-start gap-3"
          data-testid={`mini-preview-wrap-${templateKey}`}
        >
          {slotCapable ? (
            <>
              <OverlayMiniPreview
                sessionId={sessionId}
                viewToken={viewToken}
                templateKey={templateKey as TemplateKey}
                slot="primary"
              />
              <OverlayMiniPreview
                sessionId={sessionId}
                viewToken={viewToken}
                templateKey={templateKey as TemplateKey}
                slot="secondary"
              />
            </>
          ) : (
            <OverlayMiniPreview
              sessionId={sessionId}
              viewToken={viewToken}
              templateKey={templateKey as TemplateKey}
            />
          )}
        </div>
      ) : null}

      {/* Structured form path — renders a dedicated component for the
          templateKey. Presets + save-preset still available below. */}
      {isStructured ? (
        <div
          className="mb-4 space-y-3"
          data-testid={`structured-form-${templateKey}`}
        >
          {templateKey === "score_bug" ? (
            <StructuredScoreBugForm
              sessionId={sessionId}
              isLive={isLive}
              selectable={selectable ?? []}
              activeSingle={activeSingle ?? null}
            />
          ) : null}
          {templateKey === "up_next_bug" ? (
            <StructuredUpNextForm
              sessionId={sessionId}
              isLive={isLive}
              unplayed={unplayed ?? []}
            />
          ) : null}
          {templateKey === "starting_soon_timer" ? (
            <StructuredStartingSoonForm
              sessionId={sessionId}
              isLive={isLive}
            />
          ) : null}
          {templateKey === "layout_brb_full" ? (
            <StructuredBrbForm sessionId={sessionId} isLive={isLive} />
          ) : null}
          {templateKey === "featured_comment" ? (
            <StructuredFeaturedCommentForm
              sessionId={sessionId}
              isLive={isLive}
            />
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {/* Presets list */}
        <div className="space-y-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Presets
          </h3>
          <ul
            className="space-y-1.5 max-h-[260px] overflow-auto"
            data-testid={`presets-${templateKey}`}
          >
            {presets.length === 0 ? (
              <li className="text-xs text-[var(--chalk-3)]">No presets yet</li>
            ) : (
              presets.map((p) => (
                <li
                  key={p.id}
                  className="rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-3)]/30 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-[var(--chalk-1)]">
                        {p.label}
                        {p.isDefault ? (
                          <span className="ml-1 text-[9px] uppercase tracking-[0.18em] text-[var(--signal)]">
                            default
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <form action={loadPresetAction}>
                        <input type="hidden" name="presetId" value={p.id} />
                        <input
                          type="hidden"
                          name="sessionId"
                          value={sessionId}
                        />
                        {multiInstance ? (
                          <input
                            type="hidden"
                            name="instanceSlot"
                            value="1"
                          />
                        ) : null}
                        <button
                          type="submit"
                          disabled={!isLive}
                          data-testid={`load-preset-${p.id}`}
                          className="rounded-sm border border-[var(--signal)]/50 bg-transparent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--signal)] hover:bg-[var(--signal)]/10 disabled:opacity-40"
                        >
                          Load
                        </button>
                      </form>
                      <form action={deletePresetAction}>
                        <input type="hidden" name="presetId" value={p.id} />
                        <input
                          type="hidden"
                          name="sessionId"
                          value={sessionId}
                        />
                        <button
                          type="submit"
                          data-testid={`delete-preset-${p.id}`}
                          className="rounded-sm border border-[var(--ink-4)] bg-transparent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--chalk-3)] hover:text-[var(--flare)] hover:border-[var(--flare)]/40"
                        >
                          Del
                        </button>
                      </form>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Edit + Trigger form — hidden for structured templates. The
            OffTriggerButton renders its own <form>, so it MUST sit as a
            sibling of this <form> (browsers reject <form> inside <form>). */}
        {isStructured ? (
          <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)] md:col-span-1">
            Structured form above replaces the raw JSON editor.
          </div>
        ) : (
          <div className="space-y-2">
            <form
              action={multiInstance ? triggerInstanceAction : triggerOverlayAction}
              className="space-y-2"
              data-testid={`trigger-form-${templateKey}`}
            >
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
                Edit & trigger
              </h3>
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="templateKey" value={templateKey} />

              {slots ? (
                <div className="flex items-center gap-3 text-[11px]">
                  {slots.map((slot, i) => (
                    <label key={slot} className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="instanceSlot"
                        value={slot}
                        defaultChecked={i === 0}
                        data-testid={`slot-radio-${templateKey}-${slot}`}
                      />
                      <span className="text-[var(--chalk-2)]">
                        {slot} · {slotLabels[i]}
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}

              {/* Plan 48 — generic asset uploaders so admins pasting JSON
                  payloads can mint signed public URLs without a round trip
                  to the CDN manager. Copy-to-clipboard fills the textarea
                  below. */}
              <div className="space-y-1.5" data-testid={`asset-uploads-${templateKey}`}>
                <AssetUploader
                  kind="image"
                  label="image"
                  showCopy
                  data-testid={`asset-upload-image-${templateKey}`}
                />
                <AssetUploader
                  kind="video"
                  label="video"
                  showCopy
                  data-testid={`asset-upload-video-${templateKey}`}
                />
              </div>
              <textarea
                name="payload"
                rows={6}
                defaultValue={JSON.stringify(starter, null, 2)}
                data-testid={`trigger-payload-${templateKey}`}
                className={textareaClass}
              />
              <div className="flex justify-end">
                <PrimaryButton
                  type="submit"
                  size="sm"
                  disabled={!isLive}
                  data-testid={`trigger-btn-${templateKey}`}
                >
                  {multiInstance ? "Trigger to slot" : "Trigger"}
                </PrimaryButton>
              </div>
            </form>
            {/* Sibling to the trigger form — OffTriggerButton owns its own
                <form action=clear*Action>. Kept outside to avoid a nested
                <form> DOM violation (browser console: "form inside form"). */}
            <div className="flex justify-end">
              <OffTriggerButton
                templateKey={templateKey}
                sessionId={sessionId}
                latestEventId={activeSingle?.id ?? null}
                instanceId={
                  multiInstance && activeInstances && activeInstances.length > 0
                    ? activeInstances[0].id
                    : null
                }
                disabled={!isLive}
                data-testid={`off-btn-${templateKey}`}
              />
            </div>
          </div>
        )}

        {/* Save preset (separate small form) + Active list */}
        <div className="space-y-3">
          <form
            action={createPresetAction}
            className="space-y-2"
            data-testid={`save-preset-${templateKey}`}
          >
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Save preset
            </h3>
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="templateKey" value={templateKey} />
            <input
              type="text"
              name="label"
              placeholder="Preset label"
              required
              maxLength={80}
              className={inputClass}
              data-testid={`preset-label-${templateKey}`}
            />
            <textarea
              name="payload"
              rows={4}
              defaultValue={JSON.stringify(starter, null, 2)}
              className={textareaClass}
              data-testid={`preset-payload-${templateKey}`}
            />
            <div className="flex justify-end">
              <SecondaryButton
                type="submit"
                size="sm"
                data-testid={`save-preset-btn-${templateKey}`}
              >
                Save preset
              </SecondaryButton>
            </div>
          </form>

          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Active
            </h3>
            <ul
              className="mt-1.5 space-y-1.5"
              data-testid={`active-${templateKey}`}
            >
              {multiInstance ? (
                slots!.map((slot, i) => {
                  const inst = (activeInstances ?? []).find(
                    (a) => a.instanceSlot === slot,
                  );
                  return (
                    <li
                      key={slot}
                      className="flex items-center justify-between rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-3)]/40 px-2 py-1.5"
                      data-testid={`active-slot-${templateKey}-${slot}`}
                    >
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)]">
                          slot {slot} · {slotLabels[i]}
                        </div>
                        <div className="truncate font-mono text-[10px] text-[var(--chalk-3)]">
                          {inst
                            ? `${formatWat(inst.triggeredAt, "HH:mm:ss")} · ${JSON.stringify(inst.payload).slice(0, 36)}`
                            : "—"}
                        </div>
                      </div>
                      {inst ? (
                        <form action={clearInstanceAction}>
                          <input
                            type="hidden"
                            name="instanceId"
                            value={inst.id}
                          />
                          <input
                            type="hidden"
                            name="sessionId"
                            value={sessionId}
                          />
                          <DangerButton
                            type="submit"
                            size="sm"
                            data-testid={`clear-slot-${templateKey}-${slot}`}
                          >
                            Clear
                          </DangerButton>
                        </form>
                      ) : null}
                    </li>
                  );
                })
              ) : activeSingle ? (
                <li className="flex items-center justify-between rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-3)]/40 px-2 py-1.5">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)]">
                      live
                    </div>
                    <div className="truncate font-mono text-[10px] text-[var(--chalk-3)]">
                      {formatWat(activeSingle.triggered_at, "HH:mm:ss")} ·{" "}
                      {JSON.stringify(activeSingle.payload).slice(0, 40)}
                    </div>
                  </div>
                  <form action={clearOverlayAction}>
                    <input
                      type="hidden"
                      name="eventId"
                      value={activeSingle.id}
                    />
                    <input
                      type="hidden"
                      name="sessionId"
                      value={sessionId}
                    />
                    <DangerButton
                      type="submit"
                      size="sm"
                      data-testid={`clear-${templateKey}`}
                    >
                      Clear
                    </DangerButton>
                  </form>
                </li>
              ) : (
                <li className="text-xs text-[var(--chalk-3)]">No active</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
