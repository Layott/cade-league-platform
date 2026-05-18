"use client";

import { create } from "zustand";
import { temporal } from "zundo";
import { nanoid } from "nanoid";
import type {
  AdvancedTimelineTrack,
  AnimType,
  Animation,
  BezierEasing,
  Design,
  Element,
  ElementType,
  Keyframe,
  PresetAnim,
  TimelineProperty,
} from "@/server/overlays/builder/types";
import type { SaveDesignInput } from "@/app/admin/broadcast/v2/builder/schemas";
import type { PenDraftNode } from "./pen-types";

// ─────────────────────────────────────────────────────────────
// Wave 3B — advanced-timeline action types
// ─────────────────────────────────────────────────────────────
export type AnimPhase = "entry" | "exit" | "loop";
export type AnimationMode = "preset" | "advanced";

/**
 * Wave 1A — canvas editor store.
 *
 * Holds the in-flight `Design` for the active edit page plus selection /
 * zoom / dirty state. Mutations flow through actions that produce new
 * immutable snapshots; `zundo` middleware captures each snapshot into
 * past/future stacks for undo/redo.
 *
 * History capped at 100 entries per spec §5.2.
 *
 * Camelcase throughout the client-side types; `toServerJson()` converts
 * to the snake_case wire format that `saveDesignAction` expects
 * (per Task 17 schemas).
 */
export type BuilderState = {
  design: Design | null;
  selectedElementIds: string[];
  activeSceneId: string | null;
  zoomLevel: number;
  dirty: boolean;

  // Wave 1C — pen-tool mode + in-flight draft
  toolMode: "select" | "pen";
  penDraft: { nodes: PenDraftNode[]; closed: boolean } | null;
  setToolMode: (mode: "select" | "pen") => void;
  startPenDraft: () => void;
  appendPenNode: (node: PenDraftNode) => void;
  updatePenNode: (index: number, patch: Partial<PenDraftNode>) => void;
  completePenDraft: (sceneId: string, transform: import("@/server/overlays/builder/types").Transform) => void;
  cancelPenDraft: () => void;

  loadDesign: (design: Design) => void;
  addElement: (
    sceneId: string,
    elementType: ElementType,
    defaults: Partial<Omit<Element, "id" | "elementType" | "sceneId">>,
  ) => void;
  updateElement: (elementId: string, patch: Partial<Element>, opts?: { transient?: boolean }) => void;
  commitTransientHistory: () => void;
  deleteElement: (elementId: string) => void;
  selectElement: (elementId: string, additive?: boolean) => void;
  reorderElement: (elementId: string, newZIndex: number) => void;
  setZoom: (level: number) => void;
  markClean: () => void;

  // Wave 1C — grouping actions
  groupElements: (elementIds: string[]) => void;
  ungroupElements: (groupId: string) => void;

  // Wave 1C — multi-select
  selectMultiple: (ids: string[]) => void;

  // Wave 3A — scene mutations + mode toggle
  setActiveScene: (sceneId: string) => void;
  addScene: (scene: Design["scenes"][number]) => void;
  updateScene: (
    sceneId: string,
    patch: Partial<Pick<Design["scenes"][number], "name" | "durationMs" | "transitionIn" | "transitionOut">>,
  ) => void;
  deleteScene: (sceneId: string) => void;
  reorderScenes: (sceneIdOrder: string[]) => void;
  setMode: (mode: "single" | "sequence") => void;

  // ── Wave 3B: advanced-timeline actions ─────────────────────
  setElementAnimationMode: (
    elementId: string,
    phase: AnimPhase,
    mode: AnimationMode,
  ) => void;
  addKeyframe: (
    elementId: string,
    phase: AnimPhase,
    property: TimelineProperty,
    timeMs: number,
    value: number | string,
  ) => void;
  updateKeyframe: (
    elementId: string,
    phase: AnimPhase,
    property: TimelineProperty,
    keyframeId: string,
    patch: Partial<Pick<Keyframe, "timeMs" | "value" | "easingOut">>,
  ) => void;
  removeKeyframe: (
    elementId: string,
    phase: AnimPhase,
    property: TimelineProperty,
    keyframeId: string,
  ) => void;
  setBezierEasing: (
    elementId: string,
    phase: AnimPhase,
    property: TimelineProperty,
    keyframeId: string,
    easing: BezierEasing | null,
  ) => void;

  // ── Wave 3B (Task 5+6): timeline panel visibility ─────────────
  //
  // Toggled from the Properties panel's "Open Timeline" button when
  // a phase is switched to advanced mode. TimelinePanel (Task 6) reads
  // this flag to mount itself into the bottom dock.
  timelinePanelOpen: boolean;
  toggleTimelinePanel: () => void;
  openTimelinePanel: () => void;
  closeTimelinePanel: () => void;

  // ── Wave 3B (Task 7): per-(element, phase) timeline cursor ────
  //
  // TimelineRuler renders a draggable vertical cursor showing the
  // current scrub position. State is keyed by elementId then phase so
  // switching elements or phases preserves the last-scrubbed position
  // per slot. Task 11 reads this to drive the CanvasStage scrub
  // preview. Defaults to 0ms when no entry exists.
  timelineCursorMs: Record<string, Partial<Record<AnimPhase, number>>>;
  setTimelineCursor: (
    elementId: string,
    phase: AnimPhase,
    ms: number,
  ) => void;

  // ── Wave 3B (Task 9): selected keyframe id ────────────────────
  //
  // TimelineTracks routes click-on-KeyframeNode into this slot so the
  // KeyframeInspector (Task 12) can read which keyframe is currently
  // being edited. Holds a single id at a time across all tracks /
  // phases / elements — switching selection in any track replaces it.
  // `null` clears the selection (e.g. after delete or click-empty).
  selectedKeyframeId: string | null;
  selectKeyframe: (id: string | null) => void;
};

// ─────────────────────────────────────────────────────────────
// Module-scoped transient depth counter.
// Tracks how many in-flight transient updateElement calls are
// active. Used by commitTransientHistory() to know whether a
// coalesced entry needs to be pushed.
// ─────────────────────────────────────────────────────────────
let transientDepth = 0;

/**
 * Element/scene/group IDs MUST be valid v4 UUIDs because the underlying
 * `overlay_user_design_elements.id` / `overlay_user_design_scenes.id`
 * columns are `uuid PRIMARY KEY` (migration 20260901000002). Generating
 * the id on the client lets the same value round-trip through Save →
 * server INSERT → page reload without an id rewrite step.
 *
 * Prefers the native `crypto.randomUUID()` (available in browsers since
 * 2022 + Node 14.17+); falls back to a deterministic v4-shaped string
 * built from `crypto.getRandomValues` for older sandboxes (jsdom in
 * Vitest sometimes lacks `randomUUID` depending on Node minor version).
 *
 * Keyframe IDs continue to use `nanoid(8)` — they are nested inside
 * `animation.advancedTimeline[i].keyframes[j].id` (jsonb) and never
 * become DB column values, so the 8-char alphabet is fine there.
 */
export function makeUuid(): string {
  if (typeof crypto !== "undefined") {
    const cAny = crypto as Crypto & { randomUUID?: () => string };
    if (typeof cAny.randomUUID === "function") {
      return cAny.randomUUID();
    }
    if (typeof cAny.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      cAny.getRandomValues(bytes);
      // RFC 4122 section 4.4 — set version (4) + variant (10) bits.
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return (
        hex.slice(0, 8) +
        "-" +
        hex.slice(8, 12) +
        "-" +
        hex.slice(12, 16) +
        "-" +
        hex.slice(16, 20) +
        "-" +
        hex.slice(20, 32)
      );
    }
  }
  // Last-resort fallback (jsdom without webcrypto): Math.random v4 shape.
  // Cryptographically weak but acceptable for test-only fallback —
  // production paths always hit one of the branches above.
  const rnd = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${rnd()}${rnd()}-${rnd()}-4${rnd().slice(1)}-${
    ((Math.floor(Math.random() * 4) + 8).toString(16) + rnd().slice(1))
  }-${rnd()}${rnd()}${rnd()}`;
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

const replaceScene = (
  design: Design,
  sceneId: string,
  mut: (s: Design["scenes"][number]) => Design["scenes"][number],
): Design => ({
  ...design,
  scenes: design.scenes.map((s) => (s.id === sceneId ? mut(s) : s)),
});

// ─────────────────────────────────────────────────────────────
// Wave 3B helpers — element mutator + preset defaults
// ─────────────────────────────────────────────────────────────

/**
 * Locate the element by id across every scene and replace it with the
 * result of `mut`. Returns a NEW design only when the element was
 * found AND `mut` produced a non-null result; otherwise returns the
 * input design untouched so callers can branch on identity.
 */
const replaceElement = (
  design: Design,
  elementId: string,
  mut: (el: Element) => Element | null,
): Design => {
  let touched = false;
  const scenes = design.scenes.map((s) => {
    if (!s.elements.some((e) => e.id === elementId)) return s;
    return {
      ...s,
      elements: s.elements.map((e) => {
        if (e.id !== elementId) return e;
        const next = mut(e);
        if (next === null) return e;
        touched = true;
        return next;
      }),
    };
  });
  if (!touched) return design;
  return { ...design, scenes };
};

const DEFAULT_PRESET_BY_PHASE: Record<AnimPhase, AnimType> = {
  entry: "fade",
  exit: "fade",
  loop: "pulse",
};

function defaultPresetForPhase(phase: AnimPhase): PresetAnim {
  return {
    type: DEFAULT_PRESET_BY_PHASE[phase],
    durationMs: phase === "loop" ? 1200 : 400,
    delayMs: 0,
    easing: "ease-out",
  };
}

function seedAdvancedTimeline(): AdvancedTimelineTrack[] {
  return [
    {
      property: "opacity",
      keyframes: [
        { id: nanoid(8), timeMs: 0, value: 0, easingOut: null },
        { id: nanoid(8), timeMs: 600, value: 1, easingOut: null },
      ],
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────

export const useBuilderStore = create<BuilderState>()(
  temporal(
    (set) => ({
      design: null,
      selectedElementIds: [],
      activeSceneId: null,
      zoomLevel: 1.0,
      dirty: false,

      // Wave 1C — pen-tool
      toolMode: "select",
      penDraft: null,

      loadDesign: (design) =>
        set({
          design,
          activeSceneId: design.scenes[0]?.id ?? null,
          dirty: false,
          selectedElementIds: [],
        }),

      addElement: (sceneId, elementType, defaults) =>
        set((state) => {
          if (!state.design) return state;
          const scene = state.design.scenes.find((s) => s.id === sceneId);
          if (!scene) return state;
          const newEl: Element = {
            id: makeUuid(),
            sceneId,
            parentGroupId: null,
            elementType,
            zIndex: scene.elements.length,
            locked: false,
            visible: true,
            transform: {
              x: 0,
              y: 0,
              width: 200,
              height: 100,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 1,
            },
            style: {},
            content: {},
            binding: null,
            animation: {},
            ...defaults,
          };
          return {
            design: replaceScene(state.design, sceneId, (s) => ({
              ...s,
              elements: [...s.elements, newEl].sort(
                (a, b) => a.zIndex - b.zIndex,
              ),
            })),
            selectedElementIds: [newEl.id],
            dirty: true,
          };
        }),

      updateElement: (elementId, patch, opts) => {
        const transient = opts?.transient === true;
        if (transient) {
          useBuilderStore.temporal.getState().pause();
          transientDepth++;
        }
        set((state) => {
          if (!state.design) return state;
          return {
            design: {
              ...state.design,
              scenes: state.design.scenes.map((s) => ({
                ...s,
                elements: s.elements.map((e) =>
                  e.id === elementId ? ({ ...e, ...patch } as Element) : e,
                ),
              })),
            },
            dirty: true,
          };
        });
        if (transient) {
          useBuilderStore.temporal.getState().resume();
        }
      },

      commitTransientHistory: () => {
        if (transientDepth === 0) return;
        transientDepth = 0;
        // Force a single coalesced history entry by re-setting design to itself.
        set((state) => ({ design: state.design ? { ...state.design } : null }));
      },

      deleteElement: (elementId) =>
        set((state) => {
          if (!state.design) return state;
          return {
            design: {
              ...state.design,
              scenes: state.design.scenes.map((s) => ({
                ...s,
                elements: s.elements.filter((e) => e.id !== elementId),
              })),
            },
            selectedElementIds: state.selectedElementIds.filter(
              (id) => id !== elementId,
            ),
            dirty: true,
          };
        }),

      selectElement: (elementId, additive = false) =>
        set((state) => ({
          selectedElementIds: additive
            ? Array.from(new Set([...state.selectedElementIds, elementId]))
            : [elementId],
        })),

      reorderElement: (elementId, newZIndex) =>
        set((state) => {
          if (!state.design) return state;
          return {
            design: {
              ...state.design,
              scenes: state.design.scenes.map((s) => ({
                ...s,
                elements: s.elements
                  .map((e) =>
                    e.id === elementId ? { ...e, zIndex: newZIndex } : e,
                  )
                  .sort((a, b) => a.zIndex - b.zIndex),
              })),
            },
            dirty: true,
          };
        }),

      setZoom: (level) => set({ zoomLevel: level }),

      markClean: () => set({ dirty: false }),

      // ── Wave 1C: pen-tool actions ────────────────────────────────────────
      setToolMode: (mode) => set({ toolMode: mode }),

      startPenDraft: () => set({ penDraft: { nodes: [], closed: false }, toolMode: "pen" }),

      appendPenNode: (node) =>
        set((state) => {
          if (!state.penDraft) return state;
          return { penDraft: { ...state.penDraft, nodes: [...state.penDraft.nodes, node] } };
        }),

      updatePenNode: (index, patch) =>
        set((state) => {
          if (!state.penDraft) return state;
          return {
            penDraft: {
              ...state.penDraft,
              nodes: state.penDraft.nodes.map((n, i) => (i === index ? { ...n, ...patch } : n)),
            },
          };
        }),

      completePenDraft: (sceneId, transform) =>
        set((state) => {
          if (!state.penDraft || !state.design || state.penDraft.nodes.length < 2) {
            return { penDraft: null, toolMode: "select" };
          }
          // Normalize nodes to element-local coordinate space (subtract transform.x/y).
          const localNodes = state.penDraft.nodes.map((n) => ({
            x: n.x - transform.x,
            y: n.y - transform.y,
            ctrlInX: n.ctrlInX - transform.x,
            ctrlInY: n.ctrlInY - transform.y,
            ctrlOutX: n.ctrlOutX - transform.x,
            ctrlOutY: n.ctrlOutY - transform.y,
          }));
          const scene = state.design.scenes.find((s) => s.id === sceneId);
          if (!scene) return { penDraft: null, toolMode: "select" };
          const newEl: Element = {
            id: makeUuid(),
            sceneId,
            parentGroupId: null,
            elementType: "path" as const,
            zIndex: scene.elements.length,
            locked: false,
            visible: true,
            transform,
            style: { fill: "transparent", stroke: "#6bcd06", strokeWidth: 2 },
            content: { path: { nodes: localNodes, closed: state.penDraft.closed } },
            binding: null,
            animation: {},
          };
          return {
            design: {
              ...state.design,
              scenes: state.design.scenes.map((s) =>
                s.id === sceneId ? { ...s, elements: [...s.elements, newEl] } : s,
              ),
            },
            selectedElementIds: [newEl.id],
            penDraft: null,
            toolMode: "select",
            dirty: true,
          };
        }),

      cancelPenDraft: () => set({ penDraft: null, toolMode: "select" }),

      // ── Wave 1C: grouping actions ────────────────────────────────────────

      groupElements: (elementIds) =>
        set((state) => {
          if (!state.design || elementIds.length === 0) return state;
          const sceneId = state.activeSceneId;
          if (!sceneId) return state;
          const scene = state.design.scenes.find((s) => s.id === sceneId);
          if (!scene) return state;
          const validIds = elementIds.filter((id) => scene.elements.some((e) => e.id === id));
          if (validIds.length === 0) return state;
          const newGroup: Element = {
            id: makeUuid(),
            sceneId,
            parentGroupId: null,
            elementType: "group" as const,
            zIndex: scene.elements.length,
            locked: false,
            visible: true,
            transform: {
              x: 0,
              y: 0,
              width: state.design.canvasWidth,
              height: state.design.canvasHeight,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 1,
            },
            style: {},
            content: {},
            binding: null,
            animation: {},
          };
          return {
            design: {
              ...state.design,
              scenes: state.design.scenes.map((s) =>
                s.id === sceneId
                  ? {
                      ...s,
                      elements: [
                        ...s.elements.map((e) =>
                          validIds.includes(e.id) ? { ...e, parentGroupId: newGroup.id } : e,
                        ),
                        newGroup,
                      ],
                    }
                  : s,
              ),
            },
            selectedElementIds: [newGroup.id],
            dirty: true,
          } as Partial<BuilderState>;
        }),

      ungroupElements: (groupId) =>
        set((state) => {
          if (!state.design) return state;
          return {
            design: {
              ...state.design,
              scenes: state.design.scenes.map((s) => ({
                ...s,
                elements: s.elements
                  .filter((e) => e.id !== groupId)
                  .map((e) => (e.parentGroupId === groupId ? { ...e, parentGroupId: null } : e)),
              })),
            },
            selectedElementIds: state.selectedElementIds.filter((id) => id !== groupId),
            dirty: true,
          };
        }),

      // Wave 1C — multi-select (marquee / select-all / paste)
      selectMultiple: (ids) => set({ selectedElementIds: Array.from(new Set(ids)) }),

      // ── Wave 3A: scene mutations + mode toggle ───────────────────────────
      setActiveScene: (sceneId) => set({ activeSceneId: sceneId }),

      addScene: (scene) =>
        set((state) => {
          if (!state.design) return state;
          return {
            design: {
              ...state.design,
              scenes: [...state.design.scenes, scene]
                .sort((a, b) => a.orderIndex - b.orderIndex),
            },
            dirty: true,
          };
        }),

      updateScene: (sceneId, patch) =>
        set((state) => {
          if (!state.design) return state;
          return {
            design: {
              ...state.design,
              scenes: state.design.scenes.map((s) =>
                s.id === sceneId ? { ...s, ...patch } : s,
              ),
            },
            dirty: true,
          };
        }),

      deleteScene: (sceneId) =>
        set((state) => {
          if (!state.design) return state;
          const filtered = state.design.scenes
            .filter((s) => s.id !== sceneId)
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((s, idx) => ({ ...s, orderIndex: idx }));
          const nextActive =
            state.activeSceneId === sceneId
              ? filtered[0]?.id ?? null
              : state.activeSceneId;
          return {
            design: { ...state.design, scenes: filtered },
            activeSceneId: nextActive,
            dirty: true,
          };
        }),

      reorderScenes: (sceneIdOrder) =>
        set((state) => {
          if (!state.design) return state;
          const byId = new Map(state.design.scenes.map((s) => [s.id, s]));
          const reordered = sceneIdOrder
            .map((id, idx) => {
              const src = byId.get(id);
              if (!src) return null;
              return { ...src, orderIndex: idx };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null);
          return {
            design: { ...state.design, scenes: reordered },
            dirty: true,
          };
        }),

      setMode: (mode) =>
        set((state) => {
          if (!state.design) return state;
          let scenes = state.design.scenes;
          let activeSceneId = state.activeSceneId;
          if (mode === "single" && scenes.length > 1) {
            scenes = [scenes[0]];
            activeSceneId = scenes[0].id;
          }
          return {
            design: { ...state.design, mode, scenes },
            activeSceneId,
            dirty: true,
          };
        }),

      // ── Wave 3B: advanced-timeline actions ─────────────────────
      //
      // Mutual-exclusivity guard lives in `setElementAnimationMode`:
      //   - 'advanced' → 'preset' clears `advancedTimeline` from the phase
      //     and restores a real preset type (so the dropdown re-engages).
      //   - 'preset'   → 'advanced' parks the preset `type` at the 'noop'
      //     sentinel and seeds a 2-keyframe opacity track so the timeline
      //     editor isn't empty at first render.
      //
      // The other 4 actions are pure keyframe-list manipulations on the
      // active track. `removeKeyframe` collapses its parent track when
      // fewer than 2 keyframes remain so we never persist a track that
      // would fail `AdvancedTimelineTrackSchema.keyframes.min(2)`.

      setElementAnimationMode: (elementId, phase, mode) =>
        set((state) => {
          if (!state.design) return state;
          const design = replaceElement(state.design, elementId, (el) => {
            const animation: Animation = { ...(el.animation ?? {}) };
            const current: PresetAnim =
              animation[phase] ?? defaultPresetForPhase(phase);
            let nextPhase: PresetAnim;
            if (mode === "advanced") {
              nextPhase = {
                ...current,
                type: "noop",
                durationMs: current.durationMs ?? 600,
                delayMs: 0,
                easing: "linear",
                advancedTimeline: seedAdvancedTimeline(),
              };
            } else {
              const restored = defaultPresetForPhase(phase);
              // Drop `advancedTimeline` and restore a real preset `type`
              // when the current sentinel is 'noop'.
              const {
                advancedTimeline: _drop,
                keyframesBody: _alsoDrop,
                ...rest
              } = current;
              void _drop;
              void _alsoDrop;
              nextPhase = {
                ...rest,
                type: rest.type === "noop" ? restored.type : rest.type,
              };
            }
            animation[phase] = nextPhase;
            return { ...el, animation };
          });
          if (design === state.design) return state;
          return { design, dirty: true };
        }),

      addKeyframe: (elementId, phase, property, timeMs, value) =>
        set((state) => {
          if (!state.design) return state;
          // Capture the id of the newly created keyframe so we can flip
          // `selectedKeyframeId` in the same store mutation — this auto-
          // opens the KeyframeInspector when an operator clicks an empty
          // track row (Wave 3B e2e + matching UX expectation).
          let newKeyframeId: string | null = null;
          const design = replaceElement(state.design, elementId, (el) => {
            const phaseAnim = el.animation?.[phase];
            if (!phaseAnim?.advancedTimeline) return null;
            const tracks = phaseAnim.advancedTimeline;
            let track = tracks.find((t) => t.property === property);
            const newKeyframe: Keyframe = {
              id: nanoid(8),
              timeMs,
              value,
              easingOut: null,
            };
            newKeyframeId = newKeyframe.id;
            let nextTracks: AdvancedTimelineTrack[];
            if (!track) {
              track = { property, keyframes: [newKeyframe] };
              nextTracks = [...tracks, track];
            } else {
              const nextKeyframes = [...track.keyframes, newKeyframe].sort(
                (a, b) => a.timeMs - b.timeMs,
              );
              nextTracks = tracks.map((t) =>
                t.property === property
                  ? { ...t, keyframes: nextKeyframes }
                  : t,
              );
            }
            return {
              ...el,
              animation: {
                ...el.animation,
                [phase]: { ...phaseAnim, advancedTimeline: nextTracks },
              },
            };
          });
          if (design === state.design) return state;
          return {
            design,
            dirty: true,
            selectedKeyframeId: newKeyframeId ?? state.selectedKeyframeId,
          };
        }),

      updateKeyframe: (elementId, phase, property, keyframeId, patch) =>
        set((state) => {
          if (!state.design) return state;
          const design = replaceElement(state.design, elementId, (el) => {
            const phaseAnim = el.animation?.[phase];
            const tracks = phaseAnim?.advancedTimeline;
            if (!phaseAnim || !tracks) return null;
            const track = tracks.find((t) => t.property === property);
            if (!track) return null;
            if (!track.keyframes.some((k) => k.id === keyframeId)) return null;
            const nextKeyframes = track.keyframes
              .map((k) => {
                if (k.id !== keyframeId) return k;
                const next: Keyframe = { ...k };
                if (patch.timeMs !== undefined) next.timeMs = patch.timeMs;
                if (patch.value !== undefined) next.value = patch.value;
                if (patch.easingOut !== undefined)
                  next.easingOut = patch.easingOut;
                return next;
              })
              .sort((a, b) => a.timeMs - b.timeMs);
            return {
              ...el,
              animation: {
                ...el.animation,
                [phase]: {
                  ...phaseAnim,
                  advancedTimeline: tracks.map((t) =>
                    t.property === property
                      ? { ...t, keyframes: nextKeyframes }
                      : t,
                  ),
                },
              },
            };
          });
          if (design === state.design) return state;
          return { design, dirty: true };
        }),

      removeKeyframe: (elementId, phase, property, keyframeId) =>
        set((state) => {
          if (!state.design) return state;
          const design = replaceElement(state.design, elementId, (el) => {
            const phaseAnim = el.animation?.[phase];
            const tracks = phaseAnim?.advancedTimeline;
            if (!phaseAnim || !tracks) return null;
            const track = tracks.find((t) => t.property === property);
            if (!track) return null;
            const filteredKeyframes = track.keyframes.filter(
              (k) => k.id !== keyframeId,
            );
            // A track requires >=2 keyframes (per schema); drop it
            // entirely once we'd fall below that floor.
            const nextTracks =
              filteredKeyframes.length < 2
                ? tracks.filter((t) => t.property !== property)
                : tracks.map((t) =>
                    t.property === property
                      ? { ...t, keyframes: filteredKeyframes }
                      : t,
                  );
            return {
              ...el,
              animation: {
                ...el.animation,
                [phase]: { ...phaseAnim, advancedTimeline: nextTracks },
              },
            };
          });
          if (design === state.design) return state;
          return { design, dirty: true };
        }),

      setBezierEasing: (elementId, phase, property, keyframeId, easing) =>
        set((state) => {
          if (!state.design) return state;
          const design = replaceElement(state.design, elementId, (el) => {
            const phaseAnim = el.animation?.[phase];
            const tracks = phaseAnim?.advancedTimeline;
            if (!phaseAnim || !tracks) return null;
            const track = tracks.find((t) => t.property === property);
            if (!track) return null;
            if (!track.keyframes.some((k) => k.id === keyframeId)) return null;
            const nextKeyframes = track.keyframes.map((k) =>
              k.id === keyframeId ? { ...k, easingOut: easing } : k,
            );
            return {
              ...el,
              animation: {
                ...el.animation,
                [phase]: {
                  ...phaseAnim,
                  advancedTimeline: tracks.map((t) =>
                    t.property === property
                      ? { ...t, keyframes: nextKeyframes }
                      : t,
                  ),
                },
              },
            };
          });
          if (design === state.design) return state;
          return { design, dirty: true };
        }),

      // ── Wave 3B (Task 5+6): timeline panel visibility ─────────
      timelinePanelOpen: false,
      toggleTimelinePanel: () =>
        set((state) => ({ timelinePanelOpen: !state.timelinePanelOpen })),
      openTimelinePanel: () => set({ timelinePanelOpen: true }),
      closeTimelinePanel: () => set({ timelinePanelOpen: false }),

      // ── Wave 3B (Task 7): timeline cursor (per element + phase) ─
      //
      // No clamping here on purpose — TimelineRuler clamps to its
      // current durationMs before forwarding, and downstream consumers
      // (Task 11 scrub preview) treat the value as a hint, not a hard
      // bound. Keeping the action permissive avoids stutter when the
      // active phase's duration shrinks while a cursor is in flight.
      timelineCursorMs: {},
      setTimelineCursor: (elementId, phase, ms) =>
        set((state) => ({
          timelineCursorMs: {
            ...state.timelineCursorMs,
            [elementId]: {
              ...(state.timelineCursorMs[elementId] ?? {}),
              [phase]: ms,
            },
          },
        })),

      // ── Wave 3B (Task 9): selected keyframe id ────────────────
      selectedKeyframeId: null,
      selectKeyframe: (id) => set({ selectedKeyframeId: id }),
    }),
    {
      // Track only `design` so selection / zoom / dirty don't pollute history.
      partialize: (state) => ({ design: state.design }),
      limit: 100,
    },
  ),
);

/**
 * Convenience reference to the temporal slice (undo/redo/clear/
 * pastStates/futureStates). Exported symmetrically with `useBuilderStore`
 * so callers import from a single module.
 */
export const useTemporalStore = useBuilderStore.temporal;

// ─────────────────────────────────────────────────────────────
// toServerJson — camelCase Design → snake_case SaveDesignInput
//
// Converts the client-side Design type (camelCase) to the wire format
// expected by saveDesignAction (snake_case nested fields per Task 17
// schemas.ts). Lives here so the store and its callers stay co-located;
// tests cover the conversion shape explicitly.
// ─────────────────────────────────────────────────────────────

export function toServerJson(design: Design): SaveDesignInput {
  return {
    id: design.id,
    slug: design.slug,
    title: design.title,
    description: design.description ?? null,
    mode: design.mode,
    status: design.status,
    canvas_width: design.canvasWidth,
    canvas_height: design.canvasHeight,
    scenes: design.scenes.map((scene) => ({
      id: scene.id,
      order_index: scene.orderIndex,
      name: scene.name ?? null,
      duration_ms: scene.durationMs,
      transition_in: scene.transitionIn as SaveDesignInput["scenes"][number]["transition_in"],
      transition_out: scene.transitionOut as SaveDesignInput["scenes"][number]["transition_out"],
      elements: scene.elements.map((el) => ({
        id: el.id,
        scene_id: el.sceneId,
        parent_group_id: el.parentGroupId ?? null,
        element_type: el.elementType,
        z_index: el.zIndex,
        locked: el.locked,
        visible: el.visible,
        transform: el.transform,
        style: el.style,
        content: el.content ?? null,
        binding: el.binding ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        animation: (el.animation ?? null) as any,
      })),
    })),
  };
}
