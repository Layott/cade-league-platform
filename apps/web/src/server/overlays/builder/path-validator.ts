/**
 * Overlay Builder — path geometry validator.
 *
 * Validates PathSpec payloads stored on path-element `content.path`.
 * Three guard layers:
 *   1. Zod parse via PathSpecSchema (rejects missing nodes / wrong types).
 *   2. Numeric sanity sweep (every coordinate finite, not NaN).
 *   3. Optional bounds check against the canvas (default 1920x1080).
 *
 * Returns the discriminated-union shape every other validator uses so
 * elements.ts aggregates failures uniformly.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §11
 */

import { PathSpecSchema, type PathSpec } from "./types";

const MAX_NODES = 500;

export type PathValidateOptions = {
  /** Soft canvas bounds; coordinates outside are rejected. Default 1920x1080. */
  maxX?: number;
  maxY?: number;
  /** Toggle off the bounds sweep entirely (e.g. for non-canvas-targeted callers). */
  skipBoundsCheck?: boolean;
};

export type PathValidateResult =
  | { ok: true; value: PathSpec }
  | { ok: false; errors: string[] };

export function validatePath(
  raw: unknown,
  opts: PathValidateOptions = {},
): PathValidateResult {
  const errors: string[] = [];

  // Pre-validate node count for a cleaner error message before Zod.
  if (
    raw !== null &&
    typeof raw === "object" &&
    "nodes" in (raw as Record<string, unknown>) &&
    Array.isArray((raw as Record<string, unknown>).nodes) &&
    ((raw as Record<string, unknown>).nodes as unknown[]).length < 2
  ) {
    return {
      ok: false,
      errors: [`path: at least 2 nodes required, got ${((raw as Record<string, unknown>).nodes as unknown[]).length}`],
    };
  }

  const parsed = PathSpecSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`path.${issue.path.join(".")}: ${issue.message}`);
    }
    return { ok: false, errors };
  }

  const value = parsed.data;

  if (value.nodes.length > MAX_NODES) {
    errors.push(`path: too many nodes (max ${MAX_NODES}, got ${value.nodes.length})`);
    return { ok: false, errors };
  }

  const maxX = opts.maxX ?? 1920;
  const maxY = opts.maxY ?? 1080;

  for (let i = 0; i < value.nodes.length; i++) {
    const n = value.nodes[i];
    const keys: Array<keyof typeof n> = ["x", "y", "ctrlInX", "ctrlInY", "ctrlOutX", "ctrlOutY"];
    for (const k of keys) {
      const v = n[k];
      if (!Number.isFinite(v)) {
        errors.push(`path.nodes[${i}].${k}: not a finite number (got ${String(v)})`);
      }
    }
    if (!opts.skipBoundsCheck) {
      // Anchor must lie within canvas; control points may overshoot for natural curves.
      if (Number.isFinite(n.x) && (n.x < -maxX || n.x > maxX * 2)) {
        errors.push(`path.nodes[${i}].x: out of canvas bounds (got ${n.x}, canvas ${maxX})`);
      }
      if (Number.isFinite(n.y) && (n.y < -maxY || n.y > maxY * 2)) {
        errors.push(`path.nodes[${i}].y: out of canvas bounds (got ${n.y}, canvas ${maxY})`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value };
}
