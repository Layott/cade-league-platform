import { z } from "zod";

/**
 * Sync schemas co-located with `./actions.ts`.
 *
 * Next.js rejects sync exports from files marked `"use server"`, so Zod
 * schemas + types live here and are imported by the server action file.
 */

export const reopenSubmissionSchema = z.object({
  submissionId: z.string().uuid(),
});

export type ReopenSubmissionInput = z.infer<typeof reopenSubmissionSchema>;
