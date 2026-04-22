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

/**
 * Plan 37 — rich panel for editable templates. Three columns:
 *
 *   1. Presets list (left)        — load / delete preset
 *   2. Edit + trigger form (mid)  — slot picker + payload textarea + save
 *   3. Active instances (right)   — per-slot live rows + clear
 *
 * For non-multi-instance templates the slot picker is hidden and the
 * "Trigger" button calls `triggerOverlayAction` instead of
 * `triggerInstanceAction`. The "Active" column shows the single live row
 * via the legacy events feed (passed in via `activeSingle`).
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
};

export function EditableTemplatePanel({
  sessionId,
  templateKey,
  isLive,
  presets,
  activeInstances,
  activeSingle,
  multiInstance,
}: EditableTemplatePanelProps) {
  const tpl = TEMPLATE_REGISTRY[templateKey];
  const starter = STARTER_PAYLOADS[templateKey] ?? {};
  const label = templateKey
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  const slots = multiInstance ? [1, 2, 3] : null;
  const slotLabels = ["bottom", "mid", "top"];

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
            {tpl.route}
          </div>
        </div>
        <Link
          href={`${getTemplateRoute(templateKey)}?session=${sessionId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
        >
          Preview ↗
        </Link>
      </div>

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

        {/* Edit + Trigger form */}
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

          <textarea
            name="payload"
            rows={6}
            defaultValue={JSON.stringify(starter, null, 2)}
            data-testid={`trigger-payload-${templateKey}`}
            className={textareaClass}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
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
