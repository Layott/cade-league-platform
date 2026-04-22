import { describe, it, expect, vi } from "vitest";
import {
  createOrg,
  linkPlayer,
  linkCoach,
  linkTeamManager,
  listOrgs,
  OrgError,
} from "./index";
import { createOrgSchema, updateOrgSchema } from "./schemas";

function mkOrgsSb(insertRow: Record<string, unknown> | null = null, listRows: unknown[] = []) {
  return {
    from: vi.fn((table: string) => {
      if (table === "organizations") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi
                .fn()
                .mockResolvedValue({ data: insertRow, error: insertRow ? null : { message: "fail" } }),
            })),
          })),
          select: vi.fn(() => ({
            is: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: listRows, error: null }),
            })),
          })),
        };
      }
      throw new Error(`unexpected: ${table}`);
    }),
  } as never;
}

describe("createOrg", () => {
  it("happy path inserts org and returns row", async () => {
    const sb = mkOrgsSb({
      id: "org-1",
      name: "Lagos Crown Esports",
      logo_url: null,
      contact_rep_user_id: null,
      status: "active",
      caution_fee_balance_coins: 0,
      created_at: "2026-05-01",
      updated_at: "2026-05-01",
      deleted_at: null,
    });
    const out = await createOrg(sb, {
      name: "Lagos Crown Esports",
      status: "active",
    });
    expect(out.id).toBe("org-1");
    expect(out.name).toBe("Lagos Crown Esports");
  });

  it("rejects invalid input via zod", async () => {
    const sb = mkOrgsSb({});
    await expect(
      createOrg(sb, { name: "" as unknown as string, status: "active" }),
    ).rejects.toThrow();
  });

  it("wraps DB error in OrgError", async () => {
    const sb = mkOrgsSb(null);
    await expect(
      createOrg(sb, { name: "X", status: "active" }),
    ).rejects.toBeInstanceOf(OrgError);
  });

  it("Plan 31 — REJECTS payloads carrying cacNumber (strict schema)", () => {
    // The zod schema is `.strict()`, so any unknown key (including the
    // dropped `cacNumber` / `cacCertUrl`) is a parse error. This guards
    // against an old caller silently passing CAC data after rollout.
    const result = createOrgSchema.safeParse({
      name: "Lagos Crown Esports",
      cacNumber: "RC-1234567",
      status: "active",
    });
    expect(result.success).toBe(false);
  });

  it("Plan 31 — REJECTS payloads carrying cacCertUrl", () => {
    const result = createOrgSchema.safeParse({
      name: "Lagos Crown Esports",
      cacCertUrl: "orgs/x/cac-cert.pdf",
      status: "active",
    });
    expect(result.success).toBe(false);
  });

  it("Plan 31 — accepts logoUrl on createOrgSchema", () => {
    const result = createOrgSchema.parse({
      name: "Lagos Crown Esports",
      logoUrl: "https://cdn.example/logo.png",
      status: "active",
    });
    expect(result.logoUrl).toBe("https://cdn.example/logo.png");
  });

  it("Plan 31 — updateOrgSchema rejects cacNumber", () => {
    const result = updateOrgSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      cacNumber: "RC-1",
    });
    expect(result.success).toBe(false);
  });
});

describe("linkPlayer", () => {
  it("sets players.organization_id on the given player", async () => {
    const updateEq = vi.fn(() => ({
      is: vi.fn().mockResolvedValue({ error: null }),
    }));
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "players") {
          return { update: vi.fn(() => ({ eq: updateEq })) };
        }
        throw new Error(`unexpected: ${table}`);
      }),
    } as never;

    await linkPlayer(sb, {
      orgId: "11111111-1111-4111-8111-111111111111",
      playerId: "22222222-2222-4222-8222-222222222222",
    });
    expect(updateEq).toHaveBeenCalledTimes(1);
  });
});

describe("linkCoach (Plan 31)", () => {
  function mkPlayerScopedSb(orgId: string | null) {
    const updateEqMock = vi.fn().mockResolvedValue({ error: null });
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "players") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "p-1", organization_id: orgId },
                    error: null,
                  }),
                })),
              })),
            })),
            update: vi.fn(() => ({ eq: updateEqMock })),
          };
        }
        throw new Error(`unexpected: ${table}`);
      }),
    } as never;
    return { sb, updateEqMock };
  }

  it("sets players.coach_id when player is in given org", async () => {
    const orgId = "11111111-1111-4111-8111-111111111111";
    const { sb, updateEqMock } = mkPlayerScopedSb(orgId);
    await linkCoach(sb, {
      orgId,
      playerId: "22222222-2222-4222-8222-222222222222",
      coachUserId: "33333333-3333-4333-8333-333333333333",
    });
    expect(updateEqMock).toHaveBeenCalledTimes(1);
  });

  it("rejects when player is not in the org", async () => {
    const { sb } = mkPlayerScopedSb("99999999-9999-4999-8999-999999999999");
    await expect(
      linkCoach(sb, {
        orgId: "11111111-1111-4111-8111-111111111111",
        playerId: "22222222-2222-4222-8222-222222222222",
        coachUserId: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toThrow(/not in given org/);
  });
});

describe("linkTeamManager (Plan 31)", () => {
  it("sets players.team_manager_id when player is in given org", async () => {
    const orgId = "11111111-1111-4111-8111-111111111111";
    const updateEqMock = vi.fn().mockResolvedValue({ error: null });
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "players") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "p-1", organization_id: orgId },
                    error: null,
                  }),
                })),
              })),
            })),
            update: vi.fn(() => ({ eq: updateEqMock })),
          };
        }
        throw new Error(`unexpected: ${table}`);
      }),
    } as never;
    await linkTeamManager(sb, {
      orgId,
      playerId: "22222222-2222-4222-8222-222222222222",
      teamManagerUserId: "44444444-4444-4444-8444-444444444444",
    });
    expect(updateEqMock).toHaveBeenCalledTimes(1);
  });
});

describe("listOrgs", () => {
  it("returns rows sorted server-side", async () => {
    const sb = mkOrgsSb(null, [
      { id: "a", name: "A Org" },
      { id: "b", name: "B Org" },
    ]);
    const out = await listOrgs(sb);
    expect(out).toHaveLength(2);
  });
});
