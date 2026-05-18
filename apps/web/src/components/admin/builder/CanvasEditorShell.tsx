"use client";

import { useEffect } from "react";
import { useBuilderStore } from "@/state/builder/store";
import { useBuilderShortcuts } from "./useBuilderShortcuts";
import { TopBar } from "./TopBar";
import { Toolbar } from "./Toolbar";
import { CanvasStage } from "./CanvasStage";
import { PropertiesPanel } from "./PropertiesPanel";
import { LayersPanel } from "./LayersPanel";
import { DataSlotsPanel } from "./DataSlotsPanel";
import { PsdPlaceDrawer } from "./PsdPlaceDrawer";
import { ScenePicker } from "./ScenePicker";
import type { Design } from "@/server/overlays/builder/types";
import type { UploadedFontMeta } from "./FontFamilyPicker";

/**
 * Wave 1A — canvas editor shell.
 *
 * Lays out the four-pane editor:
 *
 * ```
 * +-----------------------------------------------+
 * | TopBar (title + Save + Publish + Revert)       |
 * +-----+-----------------------------------+------+
 * |     |                                   |      |
 * | Tool|        CanvasStage                | Prop |
 * | bar |  (react-konva Stage 1920×1080)    | Pane |
 * |     +-----------------------------------+      |
 * |     |   LayersPanel (bottom)            |      |
 * +-----+-----------------------------------+------+
 * ```
 *
 * On mount: hydrates the zustand store via `loadDesign(design)`.
 * All panel components (Toolbar / CanvasStage / PropertiesPanel /
 * LayersPanel) are stub placeholders in Wave 1A — Tasks 23-26 replace
 * them with real implementations.
 */
export function CanvasEditorShell({
  design,
  uploadedFonts = [],
  photopeaEnabled = false,
}: {
  design: Design;
  uploadedFonts?: UploadedFontMeta[];
  photopeaEnabled?: boolean;
}) {
  const loadDesign = useBuilderStore((s) => s.loadDesign);

  useEffect(() => {
    loadDesign(design);
  }, [design, loadDesign]);

  useBuilderShortcuts();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-black text-white">
      <TopBar />
      <ScenePicker />
      <div className="flex min-h-0 flex-1">
        <Toolbar />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto bg-zinc-900">
            <CanvasStage />
          </div>
          <LayersPanel />
        </div>
        <PropertiesPanel uploadedFonts={uploadedFonts} />
      </div>
      <DataSlotsPanel />
      <PsdPlaceDrawer
        designSlug={design.slug}
        photopeaEnabled={photopeaEnabled}
      />
    </div>
  );
}
