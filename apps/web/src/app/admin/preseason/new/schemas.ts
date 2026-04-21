import { z } from "zod";

export const createShootFormSchema = z.object({
  seasonId: z.string().uuid(),
  shootDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  type: z.enum(["photo", "video", "interview"]),
  location: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});
export type CreateShootForm = z.infer<typeof createShootFormSchema>;

export function parseCreateShootForm(fd: FormData): CreateShootForm {
  return createShootFormSchema.parse({
    seasonId: fd.get("seasonId"),
    shootDate: fd.get("shootDate"),
    type: fd.get("type"),
    location: fd.get("location"),
  });
}
