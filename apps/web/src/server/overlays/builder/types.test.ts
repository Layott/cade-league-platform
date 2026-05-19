import { describe, expect, it } from "vitest";
import {
  AnimationSchema,
  BindingSchema,
  DesignSchema,
  ElementSchema,
  ElementTypeSchema,
  FeedNameSchema,
  PathNodeSchema,
  PathSpecSchema,
  PresetAnimSchema,
  SceneSchema,
  ShadowSpecSchema,
  StyleSchema,
  TransformSchema,
  type Animation,
  type AnimType,
  type Binding,
  type Design,
  type Element,
  type ElementType,
  type FeedName,
  type PathNode,
  type PathSpec,
  type PresetAnim,
  type Scene,
  type ShadowSpec,
  type Style,
  type Transform,
} from "./types";

describe("types.ts — runtime Zod schemas + type aliases", () => {
  it("ElementTypeSchema accepts every union member", () => {
    const allowed: ElementType[] = [
      "rect",
      "ellipse",
      "line",
      "polygon",
      "path",
      "text",
      "image",
      "psd-layer",
      "data-slot",
      "group",
    ];
    for (const t of allowed) {
      expect(ElementTypeSchema.parse(t)).toBe(t);
    }
  });

  it("ElementTypeSchema rejects unknown values", () => {
    expect(() => ElementTypeSchema.parse("svg")).toThrow();
    expect(() => ElementTypeSchema.parse("")).toThrow();
    expect(() => ElementTypeSchema.parse(42)).toThrow();
  });

  it("FeedNameSchema accepts every catalog feed", () => {
    const feeds: FeedName[] = [
      "standings",
      "live_score",
      "top_scorers",
      "h2h",
      "match",
      "match_day",
      "custom_text",
    ];
    for (const f of feeds) {
      expect(FeedNameSchema.parse(f)).toBe(f);
    }
  });

  it("TransformSchema enforces every numeric field present", () => {
    const t: Transform = {
      x: 100,
      y: 200,
      width: 400,
      height: 200,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 0.8,
    };
    expect(TransformSchema.parse(t)).toEqual(t);
    expect(() => TransformSchema.parse({ x: 0 })).toThrow();
  });

  it("ShadowSpecSchema parses a valid drop-shadow", () => {
    const s: ShadowSpec = {
      offsetX: 4,
      offsetY: 6,
      blur: 12,
      color: "#000000",
      opacity: 0.5,
    };
    expect(ShadowSpecSchema.parse(s)).toEqual(s);
  });

  it("StyleSchema accepts a typical text style", () => {
    const s: Style = {
      fontFamily: "Agharti",
      fontSize: 64,
      color: "#ffffff",
      textAlign: "center",
    };
    expect(StyleSchema.parse(s)).toEqual(s);
  });

  it("StyleSchema accepts a typical rectangle style", () => {
    const s: Style = {
      fill: "#6bcd06",
      stroke: "#050505",
      strokeWidth: 2,
      cornerRadius: 8,
    };
    expect(StyleSchema.parse(s)).toEqual(s);
  });

  it("StyleSchema rejects non-enum textAlign", () => {
    expect(() =>
      StyleSchema.parse({ textAlign: "diagonal" } as unknown as Style),
    ).toThrow();
  });

  it("BindingSchema parses a standings binding", () => {
    const b: Binding = {
      feed: "standings",
      fieldPath: "[0].name",
      templateString: "${standings[0].name}",
    };
    expect(BindingSchema.parse(b)).toEqual(b);
  });

  it("PresetAnimSchema parses a slide-left entry", () => {
    const p: PresetAnim = {
      type: "slide-left",
      durationMs: 360,
      delayMs: 0,
      easing: "ease-out",
    };
    expect(PresetAnimSchema.parse(p)).toEqual(p);
  });

  it("AnimationSchema accepts a fully-populated 3-phase animation", () => {
    const a: Animation = {
      entry: { type: "slide-left", durationMs: 360, delayMs: 0, easing: "ease-out" },
      exit: { type: "fade", durationMs: 240, delayMs: 0, easing: "ease-in" },
      loop: { type: "pulse", durationMs: 1200, delayMs: 0, easing: "ease-in-out" },
    };
    expect(AnimationSchema.parse(a)).toEqual(a);
  });

  it("AnimationSchema accepts an empty object (no phases)", () => {
    expect(AnimationSchema.parse({})).toEqual({});
  });

  it("ElementSchema parses a text element with binding + animation", () => {
    const e: Element = {
      id: "11111111-1111-1111-1111-111111111111",
      sceneId: "22222222-2222-2222-2222-222222222222",
      parentGroupId: null,
      elementType: "text",
      zIndex: 0,
      locked: false,
      visible: true,
      transform: {
        x: 0,
        y: 0,
        width: 400,
        height: 80,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
      },
      style: { fontFamily: "Agharti", fontSize: 64, color: "#ffffff" },
      content: { text: "RANK 1" },
      binding: { feed: "standings", fieldPath: "[0].name" },
      animation: {
        entry: {
          type: "fade",
          durationMs: 300,
          delayMs: 0,
          easing: "ease-out",
        },
      },
    };
    expect(ElementSchema.parse(e)).toEqual(e);
  });

  it("SceneSchema parses a 1-element scene", () => {
    const s: Scene = {
      id: "33333333-3333-3333-3333-333333333333",
      designId: "44444444-4444-4444-4444-444444444444",
      orderIndex: 0,
      name: null,
      durationMs: 5000,
      transitionIn: "fade",
      transitionOut: "fade",
      elements: [],
    };
    expect(SceneSchema.parse(s)).toEqual(s);
  });

  it("DesignSchema parses a complete design", () => {
    const d: Design = {
      id: "55555555-5555-5555-5555-555555555555",
      slug: "my-overlay",
      title: "My Overlay",
      description: null,
      mode: "single",
      status: "draft",
      canvasWidth: 1920,
      canvasHeight: 1080,
      scenes: [],
      createdBy: "66666666-6666-6666-6666-666666666666",
    };
    expect(DesignSchema.parse(d)).toEqual(d);
  });

  it("DesignSchema rejects invalid mode + status", () => {
    expect(() =>
      DesignSchema.parse({
        id: "55555555-5555-5555-5555-555555555555",
        slug: "x",
        title: "t",
        description: null,
        mode: "multi",
        status: "draft",
        canvasWidth: 1920,
        canvasHeight: 1080,
        scenes: [],
        createdBy: "66666666-6666-6666-6666-666666666666",
      }),
    ).toThrow();
  });

  it("AnimType compile-time test (assignment-only)", () => {
    // Compile-only — this test exists to ensure the literal union is
    // exported. Vitest sees no assertion but the TS compiler does.
    const t: AnimType = "slide-left";
    expect(typeof t).toBe("string");
  });

  it("PathSpecSchema accepts a 3-node open path", () => {
    const p: PathSpec = {
      nodes: [
        { x: 0, y: 0, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 10, ctrlOutY: 10 },
        { x: 100, y: 100, ctrlInX: 90, ctrlInY: 90, ctrlOutX: 110, ctrlOutY: 110 },
        { x: 200, y: 0, ctrlInX: 190, ctrlInY: 10, ctrlOutX: 200, ctrlOutY: 0 },
      ],
      closed: false,
    };
    expect(PathSpecSchema.parse(p)).toEqual(p);
  });

  it("PathSpecSchema rejects fewer than 2 nodes", () => {
    expect(() =>
      PathSpecSchema.parse({
        nodes: [{ x: 0, y: 0, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 0, ctrlOutY: 0 }],
        closed: false,
      }),
    ).toThrow();
  });

  it("PathSpecSchema defaults closed=false when omitted", () => {
    const r = PathSpecSchema.parse({
      nodes: [
        { x: 0, y: 0, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 0, ctrlOutY: 0 },
        { x: 50, y: 50, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 0, ctrlOutY: 0 },
      ],
    });
    expect(r.closed).toBe(false);
  });

  it("PathNodeSchema requires all six numeric fields", () => {
    expect(() =>
      PathNodeSchema.parse({ x: 0, y: 0 }),
    ).toThrow();
  });
});

import {
  GradientStopSchema,
  LinearGradientSchema,
  RadialGradientSchema,
  GradientSpecSchema,
  FilterSpecSchema,
  ShadowStackSchema,
  FontUploadSchema,
  type GradientStop,
  type LinearGradient,
  type RadialGradient,
  type GradientSpec,
  type FilterSpec,
  type ShadowStack,
  type FontUpload,
} from "./types";

describe("types.ts — Wave 1B extensions (gradient/filter/shadow-stack/font)", () => {
  it("GradientStopSchema parses a valid stop", () => {
    const s: GradientStop = { offset: 0.5, color: "#6bcd06" };
    expect(GradientStopSchema.parse(s)).toEqual(s);
  });

  it("GradientStopSchema rejects offset > 1", () => {
    expect(() =>
      GradientStopSchema.parse({ offset: 1.5, color: "#fff" }),
    ).toThrow();
  });

  it("GradientStopSchema rejects offset < 0", () => {
    expect(() =>
      GradientStopSchema.parse({ offset: -0.1, color: "#fff" }),
    ).toThrow();
  });

  it("LinearGradientSchema accepts 2-stop linear gradient", () => {
    const g: LinearGradient = {
      kind: "linear",
      angle: 90,
      stops: [
        { offset: 0, color: "#6bcd06" },
        { offset: 1, color: "#fe036d" },
      ],
    };
    expect(LinearGradientSchema.parse(g)).toEqual(g);
  });

  it("LinearGradientSchema rejects single-stop gradient", () => {
    expect(() =>
      LinearGradientSchema.parse({
        kind: "linear",
        angle: 0,
        stops: [{ offset: 0, color: "#000" }],
      }),
    ).toThrow();
  });

  it("RadialGradientSchema accepts centered radial", () => {
    const g: RadialGradient = {
      kind: "radial",
      cx: 0.5,
      cy: 0.5,
      radius: 0.5,
      stops: [
        { offset: 0, color: "#ffffff" },
        { offset: 1, color: "#000000" },
      ],
    };
    expect(RadialGradientSchema.parse(g)).toEqual(g);
  });

  it("GradientSpecSchema discriminates linear vs radial via `kind`", () => {
    const linear: GradientSpec = {
      kind: "linear",
      angle: 45,
      stops: [
        { offset: 0, color: "#000" },
        { offset: 1, color: "#fff" },
      ],
    };
    expect(GradientSpecSchema.parse(linear)).toEqual(linear);

    const radial: GradientSpec = {
      kind: "radial",
      cx: 0.3,
      cy: 0.7,
      radius: 0.8,
      stops: [
        { offset: 0, color: "#6bcd06" },
        { offset: 1, color: "#fe036d" },
      ],
    };
    expect(GradientSpecSchema.parse(radial)).toEqual(radial);
  });

  it("FilterSpecSchema accepts partial filter (only blur)", () => {
    const f: FilterSpec = { blur: 8 };
    expect(FilterSpecSchema.parse(f)).toEqual(f);
  });

  it("FilterSpecSchema accepts full filter stack (all 8 fields)", () => {
    const f: FilterSpec = {
      blur: 4,
      brightness: 1.2,
      hueRotate: 180,
      saturate: 1.5,
      contrast: 150,
      grayscale: 30,
      sepia: 50,
      invert: 20,
    };
    expect(FilterSpecSchema.parse(f)).toEqual(f);
  });

  it("FilterSpecSchema rejects blur > 40", () => {
    expect(() => FilterSpecSchema.parse({ blur: 60 })).toThrow();
  });

  it("FilterSpecSchema rejects hueRotate > 360", () => {
    expect(() => FilterSpecSchema.parse({ hueRotate: 400 })).toThrow();
  });

  it("FilterSpecSchema rejects contrast > 200 and < 0", () => {
    expect(() => FilterSpecSchema.parse({ contrast: 250 })).toThrow();
    expect(() => FilterSpecSchema.parse({ contrast: -5 })).toThrow();
  });

  it("FilterSpecSchema rejects grayscale / sepia / invert > 100", () => {
    expect(() => FilterSpecSchema.parse({ grayscale: 150 })).toThrow();
    expect(() => FilterSpecSchema.parse({ sepia: 110 })).toThrow();
    expect(() => FilterSpecSchema.parse({ invert: 101 })).toThrow();
  });

  it("ShadowStackSchema accepts a single-shadow object (Wave 1A shape)", () => {
    const s = { offsetX: 2, offsetY: 4, blur: 8, color: "#000", opacity: 0.5 };
    const parsed = ShadowStackSchema.parse(s) as ShadowStack;
    expect(parsed).toEqual(s);
  });

  it("ShadowStackSchema accepts an array of shadows", () => {
    const s: ShadowStack = [
      { offsetX: 2, offsetY: 2, blur: 4, color: "#6bcd06", opacity: 0.8 },
      { offsetX: -2, offsetY: -2, blur: 4, color: "#fe036d", opacity: 0.6 },
    ];
    expect(ShadowStackSchema.parse(s)).toEqual(s);
  });

  it("FontUploadSchema accepts a TTF upload meta", () => {
    const f: FontUpload = {
      filename: "Custom Bold.ttf",
      mimeType: "font/ttf",
      sizeBytes: 102400,
    };
    expect(FontUploadSchema.parse(f)).toEqual(f);
  });

  it("FontUploadSchema rejects size over 5MB", () => {
    expect(() =>
      FontUploadSchema.parse({
        filename: "huge.ttf",
        mimeType: "font/ttf",
        sizeBytes: 6 * 1024 * 1024,
      }),
    ).toThrow();
  });

  it("FontUploadSchema rejects non-font MIME", () => {
    expect(() =>
      FontUploadSchema.parse({
        filename: "evil.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 1024,
      }),
    ).toThrow();
  });
});

import {
  AdvancedTimelineSchema,
  AdvancedTimelineTrackSchema,
  BezierEasingSchema,
  KeyframeSchema,
  TimelinePropertySchema,
  type AdvancedTimeline,
  type AdvancedTimelineTrack,
  type BezierEasing,
  type Keyframe,
  type TimelineProperty,
} from "./types";

describe("types.ts — Wave 3B advanced timeline schemas", () => {
  it("TimelinePropertySchema enumerates every animatable property", () => {
    const props: TimelineProperty[] = [
      "opacity", "x", "y", "scaleX", "scaleY", "rotation", "color", "filter",
    ];
    for (const p of props) {
      expect(TimelinePropertySchema.parse(p)).toBe(p);
    }
    expect(() => TimelinePropertySchema.parse("translateZ")).toThrow();
  });

  it("BezierEasingSchema accepts four-control-point cubic bezier", () => {
    const b: BezierEasing = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };
    expect(BezierEasingSchema.parse(b)).toEqual(b);
  });

  it("BezierEasingSchema rejects x outside [0, 1]", () => {
    expect(() =>
      BezierEasingSchema.parse({ x1: -0.1, y1: 0, x2: 0.5, y2: 1 }),
    ).toThrow();
    expect(() =>
      BezierEasingSchema.parse({ x1: 1.1, y1: 0, x2: 0.5, y2: 1 }),
    ).toThrow();
  });

  it("BezierEasingSchema accepts y in [-1, 2] (CSS cubic-bezier allowance)", () => {
    expect(
      BezierEasingSchema.parse({ x1: 0.4, y1: -0.5, x2: 0.6, y2: 1.8 }),
    ).toBeTruthy();
  });

  it("KeyframeSchema parses a numeric keyframe with bezier-out", () => {
    const k: Keyframe = {
      id: "kf-1",
      timeMs: 250,
      value: 0.6,
      easingOut: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 },
    };
    expect(KeyframeSchema.parse(k)).toEqual(k);
  });

  it("KeyframeSchema accepts string values for color/filter properties", () => {
    const k: Keyframe = {
      id: "kf-2",
      timeMs: 500,
      value: "#fe036d",
      easingOut: null,
    };
    expect(KeyframeSchema.parse(k)).toEqual(k);
  });

  it("KeyframeSchema rejects negative timeMs", () => {
    expect(() =>
      KeyframeSchema.parse({ id: "kf-3", timeMs: -10, value: 1, easingOut: null }),
    ).toThrow();
  });

  it("AdvancedTimelineTrackSchema enforces a property + keyframes array", () => {
    const t: AdvancedTimelineTrack = {
      property: "opacity",
      keyframes: [
        { id: "kf-a", timeMs: 0, value: 0, easingOut: null },
        { id: "kf-b", timeMs: 600, value: 1, easingOut: null },
      ],
    };
    expect(AdvancedTimelineTrackSchema.parse(t)).toEqual(t);
  });

  it("AdvancedTimelineSchema accepts an array of tracks", () => {
    const tl: AdvancedTimeline = [
      {
        property: "opacity",
        keyframes: [
          { id: "k1", timeMs: 0, value: 0, easingOut: null },
          { id: "k2", timeMs: 600, value: 1, easingOut: null },
        ],
      },
    ];
    expect(AdvancedTimelineSchema.parse(tl)).toEqual(tl);
  });

  it("AnimationSchema accepts entry.advancedTimeline alongside no preset", () => {
    const a: Animation = {
      entry: {
        type: "fade",
        durationMs: 600,
        delayMs: 0,
        easing: "ease-out",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: 0, easingOut: null },
              { id: "k2", timeMs: 600, value: 1, easingOut: null },
            ],
          },
        ],
      },
    };
    expect(AnimationSchema.parse(a)).toBeTruthy();
  });
});
