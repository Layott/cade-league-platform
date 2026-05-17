"use client";

/**
 * Wave 1A stub — replaced by Task 27.
 *
 * Renders a placeholder data-slots sidebar so CanvasEditorShell mounts
 * without errors. Real data-slot binding UI lands in Task 27.
 */
export function DataSlotsPanel() {
  return (
    <aside
      className="w-[280px] shrink-0 border-l border-white/10 bg-zinc-950"
      aria-label="Data Slots"
      data-builder-component="DataSlotsPanel"
    />
  );
}
