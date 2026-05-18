"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDesignAction, softDeleteDesignAction } from "@/app/admin/broadcast/v2/builder/actions";
import type { DesignSummary } from "@/server/overlays/builder/designs";
import type { Scene } from "@/server/overlays/builder/types";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";

/**
 * Wave 3B Task 16 — card prop shape accepts an OPTIONAL `scenes` field so
 * the library can surface an "Animations: advanced" badge on designs that
 * carry at least one advancedTimeline keyframe track. `DesignSummary` from
 * `listDesigns` does not currently include scenes — when absent the badge
 * is simply hidden. Future server work can extend the summary projection
 * to populate this without touching the component.
 */
export type BuilderLibraryCard = DesignSummary & { scenes?: Scene[] };

/**
 * Wave 3B Task 16 helper — walks scenes / elements / animation phases
 * and returns true if ANY phase carries a non-empty advancedTimeline.
 */
export function hasAdvancedTimeline(scenes: Scene[] | undefined): boolean {
  if (!scenes) return false;
  for (const scene of scenes) {
    for (const el of scene.elements) {
      const phases = [el.animation?.entry, el.animation?.exit, el.animation?.loop];
      for (const phase of phases) {
        if ((phase?.advancedTimeline?.length ?? 0) > 0) return true;
      }
    }
  }
  return false;
}

/**
 * Wave 1A — overlay builder library.
 *
 * Lists all designs with status badge + meta and a New Design modal
 * that creates an empty design and routes to its canvas editor.
 *
 * Thumbnails are placeholder gradients in Wave 1A — Wave 1B writes
 * real thumbs via a headless-screenshot path.
 *
 * Note: createDesignAction is a FormData server action. This component
 * builds a FormData object from the modal form state before calling it.
 */
export function BuilderLibrary({ designs }: { designs: BuilderLibraryCard[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"single" | "sequence">("single");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("title", title.trim());
    fd.set("mode", mode);
    startTransition(async () => {
      try {
        const res = await createDesignAction(fd);
        if (!res?.slug) {
          setError("Server returned no slug — try again.");
          return;
        }
        router.push(`/admin/broadcast/v2/builder/${res.slug}/edit`);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to create design.",
        );
      }
    });
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Overlay Designs</h1>
        <PrimaryButton type="button" onClick={() => setOpen(true)}>
          New Design
        </PrimaryButton>
      </header>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {designs.map((d) => (
          <DesignCard key={d.id} design={d} />
        ))}
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => !isPending && setOpen(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            className="w-full max-w-md rounded-lg border border-white/10 bg-zinc-950 p-6 shadow-xl"
          >
            <h2 className="mb-4 text-xl font-semibold">New Overlay Design</h2>

            <label className="mb-3 block">
              <span className="mb-1 block text-sm text-white/70">Title</span>
              <input
                aria-label="Title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                minLength={2}
                maxLength={80}
                className="w-full rounded border border-white/20 bg-black px-3 py-2 text-white"
              />
            </label>

            <fieldset className="mb-4">
              <legend className="mb-1 block text-sm text-white/70">Mode</legend>
              <label className="mr-4 inline-flex items-center gap-2">
                <input
                  aria-label="Single"
                  type="radio"
                  name="mode"
                  value="single"
                  checked={mode === "single"}
                  onChange={() => setMode("single")}
                />
                <span>Single</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  aria-label="Sequence"
                  type="radio"
                  name="mode"
                  value="sequence"
                  checked={mode === "sequence"}
                  onChange={() => setMode("sequence")}
                />
                <span>Sequence</span>
              </label>
            </fieldset>

            {error && <p className="mb-3 text-sm text-rose-400">{error}</p>}

            <div className="flex justify-end gap-3">
              <SecondaryButton
                type="button"
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </SecondaryButton>
              <PrimaryButton
                type="submit"
                disabled={isPending || title.trim().length < 2}
              >
                {isPending ? "Creating…" : "Create"}
              </PrimaryButton>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function DesignCard({ design }: { design: BuilderLibraryCard }) {
  const router = useRouter();
  const [isDeleting, startDelete] = useTransition();
  const updated = design.updatedAt
    ? new Date(design.updatedAt).toLocaleDateString()
    : "—";
  const advanced = hasAdvancedTimeline(design.scenes);

  function onDelete() {
    const ok = window.confirm(
      `Delete "${design.title}"? You can restore it from Admin > Trash later.`,
    );
    if (!ok) return;
    startDelete(async () => {
      try {
        await softDeleteDesignAction(design.id);
        router.refresh();
      } catch (e) {
        console.error("softDeleteDesignAction failed", e);
        window.alert("Delete failed — see console.");
      }
    });
  }

  return (
    <article className="group overflow-hidden rounded-lg border border-white/10 bg-zinc-950 transition hover:border-[#6bcd06]/60">
      <div className="relative aspect-video bg-gradient-to-br from-zinc-800 to-zinc-900">
        {advanced && (
          <span
            data-testid="advanced-badge"
            className="absolute right-2 top-2 rounded bg-[#fe036d] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black"
          >
            Animations: advanced
          </span>
        )}
      </div>
      <div className="flex items-start justify-between p-4">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{design.title}</h3>
          <p className="mt-1 text-xs text-white/50">Updated {updated}</p>
        </div>
        <StatusBadge status={design.status} />
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-white/5 p-3">
        <button
          type="button"
          data-testid={`design-delete-${design.slug}`}
          onClick={onDelete}
          disabled={isDeleting}
          className="text-sm text-white/50 transition hover:text-rose-400 disabled:opacity-40"
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </button>
        <a
          href={`/admin/broadcast/v2/builder/${design.slug}/edit`}
          data-testid={`design-edit-${design.slug}`}
          className="text-sm text-[#6bcd06] hover:underline"
        >
          Edit
        </a>
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: DesignSummary["status"] }) {
  const cls =
    status === "published"
      ? "bg-[#6bcd06]/15 text-[#6bcd06]"
      : "bg-white/10 text-white/70";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {status}
    </span>
  );
}
