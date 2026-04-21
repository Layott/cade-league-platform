import { z } from "zod";

export const submitPostFormSchema = z.object({
  playerId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  platform: z.enum(["twitter", "instagram", "tiktok", "youtube"]),
  postUrl: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((v) => v.startsWith("https://"), {
      message: "post URL must start with https://",
    }),
});
export type SubmitPostForm = z.infer<typeof submitPostFormSchema>;

export function parseSubmitPostForm(fd: FormData): SubmitPostForm {
  return submitPostFormSchema.parse({
    playerId: fd.get("playerId"),
    weekStart: fd.get("weekStart"),
    platform: fd.get("platform"),
    postUrl: fd.get("postUrl"),
  });
}
