import { describe, it, expect, vi } from "vitest";
import { createContract, activateContract, ContractError } from "./contracts";

type ExistingCheckResult = { data: unknown; error: null };

function mkSb(opts: {
  insertRow?: Record<string, unknown> | null;
  target?: { id: string; player_id: string; season_id: string; status: string } | null;
  existing?: { id: string } | null;
  updateRow?: Record<string, unknown> | null;
}) {
  const existingCheck: ExistingCheckResult = {
    data: opts.existing ?? null,
    error: null,
  };

  return {
    from: vi.fn((table: string) => {
      if (table === "organization_contracts") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: opts.insertRow ?? null,
                error: opts.insertRow ? null : { message: "fail" },
              }),
            })),
          })),
          // select chain used in activateContract (two separate reads + update)
          select: vi.fn((cols: string) => {
            if (cols === "id, player_id, season_id, status") {
              return {
                eq: vi.fn(() => ({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: opts.target ?? null, error: null }),
                })),
              };
            }
            // The existing-active check
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    is: vi.fn(() => ({
                      neq: vi.fn(() => ({
                        maybeSingle: vi.fn().mockResolvedValue(existingCheck),
                      })),
                    })),
                  })),
                })),
              })),
            };
          }),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: opts.updateRow ?? null,
                  error: opts.updateRow ? null : { message: "update fail" },
                }),
              })),
            })),
          })),
        };
      }
      throw new Error(`unexpected: ${table}`);
    }),
  } as never;
}

describe("createContract", () => {
  it("happy path inserts contract row", async () => {
    const sb = mkSb({
      insertRow: {
        id: "c-1",
        organization_id: "o-1",
        player_id: "p-1",
        season_id: "s-1",
        contract_url: "https://example.com/c.pdf",
        valid_from: "2026-09-01",
        valid_until: "2027-06-30",
        status: "draft",
      },
    });
    const out = await createContract(sb, {
      organizationId: "11111111-1111-4111-8111-111111111111",
      playerId: "22222222-2222-4222-8222-222222222222",
      seasonId: "33333333-3333-4333-8333-333333333333",
      contractUrl: "https://example.com/c.pdf",
      validFrom: "2026-09-01",
      validUntil: "2027-06-30",
      status: "draft",
    });
    expect(out.id).toBe("c-1");
  });

  it("rejects when validFrom > validUntil", async () => {
    const sb = mkSb({ insertRow: {} });
    await expect(
      createContract(sb, {
        organizationId: "11111111-1111-4111-8111-111111111111",
        playerId: "22222222-2222-4222-8222-222222222222",
        seasonId: "33333333-3333-4333-8333-333333333333",
        contractUrl: "https://example.com/c.pdf",
        validFrom: "2027-06-30",
        validUntil: "2026-09-01",
        status: "draft",
      }),
    ).rejects.toBeInstanceOf(ContractError);
  });
});

describe("activateContract", () => {
  it("rejects when another active contract exists for same (player, season)", async () => {
    const sb = mkSb({
      target: { id: "c-new", player_id: "p-1", season_id: "s-1", status: "draft" },
      existing: { id: "c-existing" },
    });
    await expect(activateContract(sb, "c-new")).rejects.toBeInstanceOf(ContractError);
  });

  it("activates when no conflict", async () => {
    const sb = mkSb({
      target: { id: "c-new", player_id: "p-1", season_id: "s-1", status: "draft" },
      existing: null,
      updateRow: {
        id: "c-new",
        player_id: "p-1",
        season_id: "s-1",
        status: "active",
        signed_at: "2026-05-01",
      },
    });
    const out = await activateContract(sb, "c-new");
    expect(out.status).toBe("active");
  });

  it("missing contract throws", async () => {
    const sb = mkSb({ target: null });
    await expect(activateContract(sb, "nonexistent")).rejects.toThrow(/not found/);
  });
});
