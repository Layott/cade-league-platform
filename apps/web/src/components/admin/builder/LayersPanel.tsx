"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  GripVertical,
  Square,
  Type,
  Image as ImageIcon,
  Database,
  ChevronDown,
  ChevronRight,
  Layers,
} from "lucide-react";
import { useBuilderStore } from "@/state/builder/store";
import type { Element } from "@/server/overlays/builder/types";

/**
 * Wave 1A — bottom layers panel.
 *
 * Lists active scene's elements in reverse z_index order with drag-
 * reorder (@dnd-kit/sortable), visibility / lock toggles, type icon,
 * label, and delete button. Collapsible via the chevron header.
 */
export function LayersPanel() {
  const design = useBuilderStore((s) => s.design);
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const selectedIds = useBuilderStore((s) => s.selectedElementIds);
  const selectElement = useBuilderStore((s) => s.selectElement);
  const updateElement = useBuilderStore((s) => s.updateElement);
  const deleteElement = useBuilderStore((s) => s.deleteElement);
  const reorderElement = useBuilderStore((s) => s.reorderElement);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Test hook — lets test suite drive reorder without simulating dnd-kit
  // pointer events (jsdom does not support PointerSensor drag sequences).
  useEffect(() => {
    (
      window as unknown as {
        __builderTestReorder?: (id: string, z: number) => void;
      }
    ).__builderTestReorder = reorderElement;
    return () => {
      delete (
        window as unknown as { __builderTestReorder?: unknown }
      ).__builderTestReorder;
    };
  }, [reorderElement]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const scene = design?.scenes.find((s) => s.id === activeSceneId);
  // Descending z_index so topmost layer appears at top of the list.
  const sorted = scene
    ? [...scene.elements].sort((a, b) => b.zIndex - a.zIndex)
    : [];

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.over.id === e.active.id) return;
    const oldIdx = sorted.findIndex((el) => el.id === e.active.id);
    const newIdx = sorted.findIndex((el) => el.id === e.over!.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(sorted, oldIdx, newIdx);
    // Sorted list is DESC; reverse to get ascending order and re-assign
    // contiguous zIndex values 0..n-1.
    const ascending = [...next].reverse();
    ascending.forEach((el, i) => reorderElement(el.id, i));
  }

  function isGroupExpanded(id: string) {
    return expandedGroups[id] !== false; // default expanded
  }

  function toggleGroupExpand(id: string) {
    setExpandedGroups((prev) => ({ ...prev, [id]: prev[id] === false ? true : false }));
  }

  function renderRows(parentId: string | null, depth: number): React.ReactElement[] {
    const rows: React.ReactElement[] = [];
    const children = sorted.filter((el) => (el.parentGroupId ?? null) === parentId);
    for (const el of children) {
      const isGroup = el.elementType === "group";
      rows.push(
        <LayerRow
          key={el.id}
          el={el}
          depth={depth}
          selected={selectedIds.includes(el.id)}
          isGroup={isGroup}
          groupExpanded={isGroup ? isGroupExpanded(el.id) : true}
          onToggleGroupExpand={() => toggleGroupExpand(el.id)}
          onSelect={(additive) => selectElement(el.id, additive)}
          onToggleVisible={() =>
            updateElement(el.id, {
              visible: el.visible === false ? true : false,
            } as Partial<Element>)
          }
          onToggleLock={() =>
            updateElement(el.id, {
              locked: !el.locked,
            } as Partial<Element>)
          }
          onDelete={() => deleteElement(el.id)}
        />,
      );
      if (isGroup && isGroupExpanded(el.id)) {
        rows.push(...renderRows(el.id, depth + 1));
      }
    }
    return rows;
  }

  return (
    <section
      aria-label="Layers"
      className={`shrink-0 border-t border-white/10 bg-zinc-950 transition-all ${
        collapsed ? "h-9" : "h-[200px]"
      }`}
    >
      <header className="flex h-9 items-center justify-between border-b border-white/5 px-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-xs uppercase tracking-wider text-white/50"
        >
          Layers ({sorted.length}) {collapsed ? "▸" : "▾"}
        </button>
      </header>

      {!collapsed && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={sorted.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul
              role="list"
              className="h-[calc(100%-2.25rem)] overflow-auto"
            >
              {renderRows(null, 0)}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function iconFor(t: Element["elementType"]) {
  if (t === "rect") return <Square size={14} />;
  if (t === "text") return <Type size={14} />;
  if (t === "image") return <ImageIcon size={14} />;
  if (t === "data-slot") return <Database size={14} />;
  if (t === "group") return <Layers size={14} />;
  return <Square size={14} />;
}

function labelFor(el: Element): string {
  if (el.elementType === "text") {
    return ((el.content?.text as string) ?? "Text").slice(0, 40);
  }
  if (el.elementType === "image") {
    return (el.content?.assetId as string) ?? "Image";
  }
  if (el.elementType === "rect") return "Rect";
  if (el.elementType === "group") return "Group";
  return el.elementType;
}

// ─────────────────────────────────────────────────────────────
// LayerRow — individual row with sortable drag handle
// ─────────────────────────────────────────────────────────────

function LayerRow({
  el,
  depth,
  selected,
  isGroup,
  groupExpanded,
  onToggleGroupExpand,
  onSelect,
  onToggleVisible,
  onToggleLock,
  onDelete,
}: {
  el: Element;
  depth: number;
  selected: boolean;
  isGroup: boolean;
  groupExpanded: boolean;
  onToggleGroupExpand: () => void;
  onSelect: (additive: boolean) => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: el.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: depth * 16 + 8,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      role="listitem"
      data-layer-indent={depth}
      data-testid={`builder-element-row-${el.id}`}
      data-element-type={el.elementType}
      className={`flex items-center gap-2 border-b border-white/5 py-1 pr-2 text-sm ${
        selected ? "bg-[#6bcd06]/10" : "hover:bg-white/5"
      }`}
      onClick={(e) => onSelect(e.shiftKey || e.metaKey || e.ctrlKey)}
    >
      <button
        type="button"
        aria-label="Drag handle"
        {...attributes}
        {...listeners}
        className="cursor-grab text-white/40 hover:text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={14} />
      </button>

      {isGroup && (
        <button
          type="button"
          aria-label="Toggle group"
          onClick={(e) => {
            e.stopPropagation();
            onToggleGroupExpand();
          }}
          className="text-white/60 hover:text-white"
        >
          {groupExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      )}

      <button
        type="button"
        aria-label="Toggle visibility"
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisible();
        }}
        className="text-white/60 hover:text-white"
      >
        {el.visible !== false ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>

      <button
        type="button"
        aria-label="Toggle lock"
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock();
        }}
        className="text-white/60 hover:text-white"
      >
        {el.locked ? <Lock size={14} /> : <Unlock size={14} />}
      </button>

      <span className="text-white/40">{iconFor(el.elementType)}</span>
      <span className="min-w-0 flex-1 truncate text-white/80">
        {labelFor(el)}
      </span>

      <button
        type="button"
        aria-label="Delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="text-rose-400 hover:text-rose-300"
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}
