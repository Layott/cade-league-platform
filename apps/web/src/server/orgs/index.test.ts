import { describe, it, expect, vi } from "vitest";
import { createOrg, linkPlayer, listOrgs, OrgError } from "./index";

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
      cac_number: "RC-123",
      cac_cert_url: null,
      contact_rep_user_id: null,
      status: "active",
      caution_fee_balance_coins: 0,
      created_at: "2026-05-01",
      updated_at: "2026-05-01",
      deleted_at: null,
    });
    const out = await createOrg(sb, {
      name: "Lagos Crown Esports",
      cacNumber: "RC-123",
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
