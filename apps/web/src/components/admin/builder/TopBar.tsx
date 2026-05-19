"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveDesignAction,
  publishDesignAction,
  unpublishDesignAction,
  updateDesignMetaAction,
  softDeleteDesignAction,
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
  const router = useRouter();
  const design = useBuilderStore((s) => s.design);
  const dirty = useBuilderStore((s) => s.dirty);
  const markClean = useBuilderStore((s) => s.markClean);
  const setMode = useBuilderStore((s) => s.setMode);
  const timelinePanelOpen = useBuilderStore((s) => s.timelinePanelOpen);
  const toggleTimelinePanel = useBuilderStore((s) => s.toggleTimelinePanel);
  const sequenceFlagOn = isSequenceFlagOn();
  const [title, setTitle] = useState(design?.title ?? "");
  const [isSaving, startSaving] = useTransition();
  const [isPublishing, startPublishing] = useTransition();
  const [isDeleting, startDeleting] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  function onDelete() {
    if (!design) return;
    startDeleting(async () => {
      try {
        await softDeleteDesignAction(design.id);
        router.push("/admin/broadcast/v2/builder");
      } catch (e) {
        console.error("softDeleteDesignAction failed", e);
      }
    });
  }

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
    // Fix 3 (2026-05-19) — persist the mode flip to the DB immediately so
    // subsequent server actions (addSceneAction et al) don't trigger a
    // revalidatePath → RSC refetch that hydrates the editor with the
    // stale `mode: 'single'` value and flips ScenePicker off. Mode is a
    // structural flag — it must commit before any scene CRUD races.
    try {
      const ret = updateDesignMetaAction(design.id, { mode: next }) as
        | Promise<unknown>
        | undefined;
      if (ret && typeof ret.then === "function") {
        ret.catch((e) =>
          console.error("updateDesignMetaAction(mode) failed", e),
        );
      }
    } catch (e) {
      console.error("updateDesignMetaAction(mode) failed", e);
    }
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
            data-testid="builder-title-input"
            type="text"
            value={title}
            onChange={onTitleChange}
            className="w-64 rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
          />
        </label>
        {design && (
          <span
            data-testid="builder-status-badge"
            className="text-xs uppercase tracking-wider text-white/40"
          >
            {design.status}
          </span>
        )}
        {design && (
          <span
            data-testid="builder-dirty-indicator"
            data-dirty={dirty ? "true" : "false"}
            className={`text-[10px] uppercase tracking-wider transition-opacity ${
              dirty ? "text-[#fe036d]" : "text-white/20 opacity-60"
            }`}
            aria-label={dirty ? "unsaved changes" : "no unsaved changes"}
          >
            {dirty ? "• unsaved" : "• saved"}
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
          onClick={toggleTimelinePanel}
          aria-pressed={timelinePanelOpen}
          aria-label="Toggle timeline"
        >
          Timeline
        </SecondaryButton>
        <SecondaryButton
          type="button"
          disabled
          title="Coming in next wave"
        >
          Revert
        </SecondaryButton>
        <SecondaryButton
          type="button"
          data-testid={
            design?.status === "published"
              ? "builder-unpublish"
              : "builder-publish"
          }
          disabled={isPublishing || !design}
          onClick={onPublishToggle}
        >
          {design?.status === "published" ? "Unpublish" : "Publish"}
        </SecondaryButton>
        <PrimaryButton
          type="button"
          data-testid="builder-save"
          disabled={!dirty || isSaving}
          onClick={onSave}
        >
          {isSaving ? "Saving…" : "Save"}
        </PrimaryButton>
        <span data-testid="builder-save-status" className="sr-only">
          {isSaving ? "saving" : dirty ? "dirty" : "saved"}
        </span>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="Design menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-testid="builder-design-menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex h-8 w-8 items-center justify-center rounded text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            ⋮
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-10 z-50 w-44 rounded-md border border-white/10 bg-zinc-900 p-1 shadow-xl"
            >
              <button
                type="button"
                role="menuitem"
                data-testid="builder-delete-design"
                disabled={isDeleting || !design}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
                className="w-full rounded px-3 py-2 text-left text-sm text-rose-300 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete design
              </button>
            </div>
          )}
          {confirmDelete && (
            <div
              role="dialog"
              aria-modal="true"
              data-testid="builder-delete-confirm-modal"
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
              onClick={() => !isDeleting && setConfirmDelete(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-lg border border-white/10 bg-zinc-950 p-5 shadow-xl"
              >
                <h2 className="mb-2 text-base font-semibold text-white">
                  Delete &quot;{design?.title ?? "this design"}&quot;?
                </h2>
                <p className="mb-4 text-sm text-white/60">
                  Soft-delete — can be restored from /admin/trash.
                </p>
                <div className="flex justify-end gap-2">
                  <SecondaryButton
                    type="button"
                    disabled={isDeleting}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </SecondaryButton>
                  <button
                    type="button"
                    data-testid="builder-confirm-delete"
                    disabled={isDeleting}
                    onClick={() => {
                      setConfirmDelete(false);
                      onDelete();
                    }}
                    className="rounded bg-rose-500 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isDeleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
