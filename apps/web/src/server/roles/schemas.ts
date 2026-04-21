import { z } from "zod";
import { ROLE_NAMES } from "@/perms";

/**
 * Zod schemas for the roles + permissions admin surface.
 *
 * Permission strings follow the "domain.verb[.qualifier]" shape used across
 * the codebase (e.g. "announcements.publish", "attendance.mark.public").
 * The wildcard "*" is also valid — it only ever lands on the admin row.
 */

// Match the DB CHECK in migration 20260428000002_role_permissions.sql.
const permissionPattern = /^[a-z][a-z0-9_]*(\.[a-z0-9_*]+)+$/;

export const permissionStringSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((s) => s === "*" || permissionPattern.test(s), {
    message:
      "permission must be '*' or a dotted lowercase identifier, e.g. 'announcements.publish'",
  });

export const roleNameSchema = z.enum(ROLE_NAMES);

export const togglePermissionSchema = z.object({
  role: roleNameSchema,
  permission: permissionStringSchema,
  grant: z.boolean(),
});
export type TogglePermissionInput = z.infer<typeof togglePermissionSchema>;

/**
 * Bulk save accepts a diff — only the cells that changed. Each entry tells
 * the server whether the checkbox is now on (`grant=true` → INSERT) or off
 * (`grant=false` → DELETE).
 */
export const bulkSaveMatrixSchema = z.object({
  diff: z.array(togglePermissionSchema).max(500),
});
export type BulkSaveMatrixInput = z.infer<typeof bulkSaveMatrixSchema>;

export const assignRoleSchema = z.object({
  userId: z.string().uuid(),
  role: roleNameSchema,
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

export const removeRoleSchema = z.object({
  userId: z.string().uuid(),
  role: roleNameSchema,
});
export type RemoveRoleInput = z.infer<typeof removeRoleSchema>;
