"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  saveDesignAction,
  publishDesignAction,
  unpublishDesignAction,
  updateDesignMetaAction,
} from "@/app/admin/broadcast/v2/builder/actions";
import { useBuilderStore, toServerJson } from "@/state/builder/store";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";

/**
 * Read the sequence-mode feature flag at render time (not via the
 * `featureFlags` singleton, which is computed once at module load).
 * Reading `process.env` directly here keeps Vitest's `vi.stubEnv`
 * pattern simple — no `resetModules` / dynamic re-import dance needed.
 */
function isSequenceFlagOn(): boolean {
  return process.env.NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED === "true";
}

/**
 * Wave 1A — canvas editor top bar.
 *
 * Title input (debounced 500 ms → updateDesignMetaAction), Save
 * (disabled until dirty), Publish/Unpublish toggle, Revert (placeholder
 * pending Wave 1B snapshot UI).
 *
 * Wave 3A — mode toggle (single ⇄ sequence) gated on
 * NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED.
 *
 * Notes on action signatures (real actions vs plan expectations):
 * - saveDesignAction(FormData) — we build FormData from toServerJson(design)
 * - publishDesignAction(designId) / unpublishDesignAction(designId) — split actions
 * - updateDesignMetaAction(designId, patch) — two positional args
 */
export function TopBar() {
  const design = useBuilderStore((s) => s.design);
  const dirty = useBuilderStore((s) => s.dirty);
  const markClean = useBuilderStore((s) => s.markClean);
  const setMode = useBuilderStore((s) => s.setMode);
  const sequenceFlagOn = isSequenceFlagOn();
  const [title, setTitle] = useState(design?.title ?? "");
  const [isSaving, startSaving] = useTransition();
  const [isPublishing, startPublishing] = useTransition();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only re-run when the design ID swaps (different design loaded).
  // We intentionally exclude design?.title from deps — the user's in-progress
  // edits must not be clobbered on every render.
  const designId = design?.id;
  useEffect(() => {
    setTitle(design?.title ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId]);

  function onTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setTitle(next);
    if (!design) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      updateDesignMetaAction(design.id, { title: next }).catch(() => {});
    }, 500);
  }

  function onSave() {
    if (!design) return;
    startSaving(async () => {
      try {
        const fd = new FormData();
        fd.set("designId", design.id);
        fd.set("design", JSON.stringify(toServerJson(design)));
        await saveDesignAction(fd);
        markClean();
      } catch (e) {
        console.error("Save failed", e);
      }
    });
  }

  function onModeChange(next: "single" | "sequence") {
    if (!design) return;
    if (next === design.mode) return;
    if (next === "single" && design.scenes.length > 1) {
      const ok = window.confirm(
        `Switching to single-scene mode will delete ${design.scenes.length - 1} scene(s). Continue?`,
      );
      if (!ok) return;
    }
    setMode(next);
  }

  function onPublishToggle() {
    if (!design) return;
    const isPublished = design.status === "published";
    startPublishing(async () => {
      try {
        if (isPublished) {
          await unpublishDesignAction(design.id);
        } else {
          await publishDesignAction(design.id);
        }
      } catch (e) {
        console.error("Publish toggle failed", e);
      }
    });
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-zinc-950 px-4">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="sr-only">Title</span>
          <input
            aria-label="Title"
            type="text"
            value={title}
            onChange={onTitleChange}
            className="w-64 rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
          />
        </label>
        {design && (
          <span className="text-xs uppercase tracking-wider text-white/40">
            {design.status}
          </span>
        )}
      </div>
      {sequenceFlagOn && design && (
        <div
          data-testid="mode-toggle"
          role="group"
          aria-label="Authoring mode"
          className="flex items-center rounded border border-white/15 text-xs"
        >
          {(["single", "sequence"] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`mode-toggle-${m}`}
              onClick={() => onModeChange(m)}
              className={`px-3 py-1 ${
                design.mode === m
                  ? "bg-[#6bcd06] text-black"
                  : "text-white/70 hover:text-white"
              }`}
            >
              {m === "single" ? "Single" : "Sequence"}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <SecondaryButton
          type="button"
          disabled
          title="Coming in next wave"
        >
          Revert
        </SecondaryButton>
        <SecondaryButton
          type="button"
          disabled={isPublishing || !design}
          onClick={onPublishToggle}
        >
          {design?.status === "published" ? "Unpublish" : "Publish"}
        </SecondaryButton>
        <PrimaryButton
          type="button"
          disabled={!dirty || isSaving}
          onClick={onSave}
        >
          {isSaving ? "Saving…" : "Save"}
        </PrimaryButton>
      </div>
    </header>
  );
}
