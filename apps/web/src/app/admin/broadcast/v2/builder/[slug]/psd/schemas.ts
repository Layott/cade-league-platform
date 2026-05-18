/**
 * Wave 2B — Zod schemas for the PSD page's server actions.
 * Lives next to `actions.ts` per CLAUDE.md §10 (action file under
 * `"use server"` exports only async fns; schemas + types here).
 */

import { z } from "zod";

/**
 * The action receives PSD bytes as a multipart `File`. Zod can't
 * directly validate a File body, so we coerce + validate at the
 * action boundary and re-use SavePsdInputSchema from the bridge
 * types for the inner contract.
 */
export const SavePsdFormSchema = z.object({
  assetId: z.string().uuid(),
  note: z.string().max(200).optional(),
});

export type SavePsdFormInput = z.infer<typeof SavePsdFormSchema>;

export const RevertSnapshotFormSchema = z.object({
  assetId: z.string().uuid(),
  snapshotId: z.string().uuid(),
});

export type RevertSnapshotFormInput = z.infer<typeof RevertSnapshotFormSchema>;
