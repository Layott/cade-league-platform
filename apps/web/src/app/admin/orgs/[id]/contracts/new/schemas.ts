import { z } from "zod";

export const createContractFormSchema = z
  .object({
    organizationId: z.string().uuid(),
    playerId: z.string().uuid("pick a player"),
    seasonId: z.string().uuid(),
    contractPath: z
      .string()
      .trim()
      .min(1, "contract file required")
      .max(500)
      // Plan 39 sanitize — block `..` traversal + backslash so a poisoned
      // contractPath can't escape the org-contracts bucket sub-tree.
      .refine(
        (v) => !v.includes("..") && !v.includes("\\"),
        "contractPath must not contain '..' or backslashes",
      ),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
    status: z.enum(["draft", "active"]).default("draft"),
  })
  .refine((d) => d.validUntil >= d.validFrom, {
    message: "validUntil must be >= validFrom",
    path: ["validUntil"],
  });
export type CreateContractForm = z.infer<typeof createContractFormSchema>;

export function parseCreateContractForm(fd: FormData): CreateContractForm {
  return createContractFormSchema.parse({
    organizationId: fd.get("organizationId"),
    playerId: fd.get("playerId"),
    seasonId: fd.get("seasonId"),
    contractPath: fd.get("contractPath"),
    validFrom: fd.get("validFrom"),
    validUntil: fd.get("validUntil"),
    status: (fd.get("status") as string) || "draft",
  });
}
