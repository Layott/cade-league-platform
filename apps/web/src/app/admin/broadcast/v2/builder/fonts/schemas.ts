import { z } from "zod";

export const UploadFontInputSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string(),
  base64: z.string().min(1),
});
export type UploadFontInput = z.infer<typeof UploadFontInputSchema>;
