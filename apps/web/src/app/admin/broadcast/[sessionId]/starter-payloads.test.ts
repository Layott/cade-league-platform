import { describe, it, expect } from "vitest";
import {
  TEMPLATE_KEYS,
  TEMPLATE_REGISTRY,
} from "@/server/overlays/registry";
import { STARTER_PAYLOADS } from "./starter-payloads";

/**
 * Regression guard: every overlay template key in the registry MUST have
 * a starter payload that schema.parse() clean. Otherwise the broadcast
 * trigger admin form would seed `{}` and `triggerOverlayAction` would
 * throw ZodError — which is exactly the user-facing bug fixed in this
 * test's parent commit.
 */
describe("STARTER_PAYLOADS", () => {
  it("has an entry for every TEMPLATE_KEYS template", () => {
    for (const key of TEMPLATE_KEYS) {
      expect(
        STARTER_PAYLOADS[key],
        `missing starter payload for "${key}"`,
      ).toBeDefined();
    }
  });

  it("each starter payload schema-validates clean", () => {
    for (const key of TEMPLATE_KEYS) {
      const starter = STARTER_PAYLOADS[key];
      const schema = TEMPLATE_REGISTRY[key].schema;
      const result = schema.safeParse(starter);
      expect(
        result.success,
        result.success
          ? "ok"
          : `"${key}" starter failed Zod: ${JSON.stringify(result.error.issues)}`,
      ).toBe(true);
    }
  });

  it("does not seed any template with an empty object", () => {
    for (const key of TEMPLATE_KEYS) {
      expect(
        Object.keys(STARTER_PAYLOADS[key] ?? {}).length,
        `"${key}" has empty starter — every template should ship at least one field`,
      ).toBeGreaterThan(0);
    }
  });
});
