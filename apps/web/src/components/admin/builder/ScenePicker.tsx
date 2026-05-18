"use client";

import { useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Copy, Trash2 } from "lucide-react";
import { useBuilderStore } from "@/state/builder/store";
import {
  addSceneAction,
  deleteSceneAction,
  reorderScenesAction,
  cloneSceneAction,
} from "@/app/admin/broadcast/v2/builder/actions";

/**
 * Wave 3A — Scene picker dock.
 *
 * Renders ONLY when design.mode === 'sequence'. Top-strip horizontal
 * scroll list with one tile per scene + a trailing Add tile. Drag-reorder
 * via @dnd-kit/sortable. Click sets active. Hover reveals Clone / Delete.
 */
export function ScenePicker() {
  const design = useBuilderStore((s) => s.design);
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const setActiveScene = useBuilderStore((s) => s.setActiveScene);
  const addSceneLocal = useBuilderStore((s) => s.addScene);
  const deleteSceneLocal = useBuilderStore((s) => s.deleteScene);
  const reorderScenesLocal = useBuilderStore((s) => s.reorderScenes);
  const [, startTransition] = useTransition();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  if (!design || design.mode !== "sequence") return null;

  const scenes = design.scenes;
  const lastIndex = scenes.length - 1;

  function handleAdd() {
    startTransition(async () => {
      try {
        const res = await addSceneAction({
          designId: design!.id,
          designSlug: design!.slug,
          afterOrderIndex: lastIndex,
        });
        if (res.ok && res.scene) addSceneLocal(res.scene);
      } catch (err) {
        console.error("addScene failed", err);
      }
    });
  }

  function handleDelete(sceneId: string) {
    if (scenes.length <= 1) return;
    const prevActive = activeSceneId;
    deleteSceneLocal(sceneId);
    startTransition(async () => {
      try {
        await deleteSceneAction({ sceneId, designSlug: design!.slug });
      } catch (err) {
        console.error("deleteScene failed", err);
        if (prevActive) setActiveScene(prevActive);
      }
    });
  }

  function handleClone(sceneId: string) {
    startTransition(async () => {
      try {
        const res = await cloneSceneAction({ sceneId, designSlug: design!.slug });
        if (res.ok && res.scene) addSceneLocal(res.scene);
      } catch (err) {
        console.error("cloneScene failed", err);
      }
    });
  }

  function handleDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    const oldIdx = scenes.findIndex((s) => s.id === active.id);
    const newIdx = scenes.findIndex((s) => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(scenes, oldIdx, newIdx);
    const order = next.map((s) => s.id);
    reorderScenesLocal(order);
    startTransition(async () => {
      try {
        await reorderScenesAction({
          designId: design!.id,
          designSlug: design!.slug,
          sceneIdOrder: order,
        });
      } catch (err) {
        console.error("reorderScenes failed", err);
      }
    });
  }

  return (
    <div
      className="flex h-24 shrink-0 items-center gap-2 overflow-x-auto border-b border-white/10 bg-zinc-950 px-3"
      aria-label="Scene picker"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={scenes.map((s) => s.id)}
          strategy={horizontalListSortingStrategy}
        >
          {scenes.map((scene, idx) => (
            <SceneTile
              key={scene.id}
              scene={scene}
              index={idx}
              active={scene.id === activeSceneId}
              onClick={() => setActiveScene(scene.id)}
              onClone={() => handleClone(scene.id)}
              onDelete={() => handleDelete(scene.id)}
              canDelete={scenes.length > 1}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button
        type="button"
        data-testid="scene-tile-add"
        onClick={handleAdd}
        className="flex h-20 w-32 shrink-0 items-center justify-center rounded border border-dashed border-white/20 text-white/40 hover:border-[#6bcd06] hover:text-[#6bcd06]"
        title="Add scene"
      >
        <Plus className="h-6 w-6" />
      </button>
    </div>
  );
}

type Scene = NonNullable<ReturnType<typeof useBuilderStore.getState>["design"]>["scenes"][number];

function SceneTile({
  scene,
  index,
  active,
  onClick,
  onClone,
  onDelete,
  canDelete,
}: {
  scene: Scene;
  index: number;
  active: boolean;
  onClick: () => void;
  onClone: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: scene.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const seconds = (scene.durationMs / 1000).toFixed(1);
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-testid={`scene-tile-${scene.id}`}
      data-active={active ? "true" : "false"}
      onClick={onClick}
      className={`group relative flex h-20 w-32 shrink-0 cursor-pointer flex-col justify-between rounded border bg-zinc-900 px-2 py-1 text-xs text-white/80 ${active ? "border-[#6bcd06]" : "border-white/15"}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-bold">{index + 1}</span>
        <span className="text-[10px] uppercase tracking-wider text-white/40">
          {scene.transitionIn}
        </span>
      </div>
      <div className="truncate text-[11px]">{scene.name ?? `Scene ${index + 1}`}</div>
      <div className="text-[10px] text-white/40">{seconds} s</div>
      <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
        <button
          type="button"
          data-testid={`scene-clone-${scene.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onClone();
          }}
          className="rounded bg-black/60 p-0.5 text-white/70 hover:text-white"
          title="Clone scene"
        >
          <Copy className="h-3 w-3" />
        </button>
        {canDelete && (
          <button
            type="button"
            data-testid={`scene-delete-${scene.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded bg-black/60 p-0.5 text-white/70 hover:text-red-400"
            title="Delete scene"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
