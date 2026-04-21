import { describe, it, expect, vi, beforeEach } from "vitest";
import { recordEntry, getBalance, LedgerError } from "./ledger";

type OrgRow = { id: string; caution_fee_balance_coins: number; deleted_at: string | null };

function mockSb(opts: {
  org?: OrgRow | null;
  insertedEntry?: Record<string, unknown>;
  insertErr?: { message: string } | null;
  updateErr?: { message: string } | null;
}) {
  const updateEq = vi.fn().mockResolvedValue({ error: opts.updateErr ?? null });
  return {
    state: { updateEq },
    sb: {
      from: vi.fn((table: string) => {
        if (table === "organizations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: opts.org ?? null, error: null }),
              })),
            })),
            update: vi.fn(() => ({ eq: updateEq })),
          };
        }
        if (table === "caution_ledger_entries") {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: opts.insertedEntry ?? {
                    id: "entry-1",
                    organization_id: "11111111-1111-4111-8111-111111111111",
                    entry_type: "deposit",
                    amount_coins: 50000,
                    direction: "credit",
                    balance_after_coins: 50000,
                    reference: null,
                    entered_by_user_id: "22222222-2222-4222-8222-222222222222",
                    entered_at: new Date().toISOString(),
                  },
                  error: opts.insertErr ?? null,
                }),
              })),
            })),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    } as never,
  };
}

describe("recordEntry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deposit credit increments balance", async () => {
    const { sb, state } = mockSb({
      org: { id: "11111111-1111-4111-8111-111111111111", caution_fee_balance_coins: 0, deleted_at: null },
    });
    const out = await recordEntry(sb, "22222222-2222-4222-8222-222222222222", {
      orgId: "11111111-1111-4111-8111-111111111111",
      entryType: "deposit",
      amountCoins: 50000,
    });
    expect(out.balance_after_coins).toBe(50000);
    expect(state.updateEq).toHaveBeenCalledTimes(1);
  });

  it("topup also credits balance", async () => {
    const { sb } = mockSb({
      org: { id: "11111111-1111-4111-8111-111111111111", caution_fee_balance_coins: 1000, deleted_at: null },
      insertedEntry: {
        id: "e",
        organization_id: "11111111-1111-4111-8111-111111111111",
        entry_type: "topup",
        amount_coins: 500,
        direction: "credit",
        balance_after_coins: 1500,
        reference: null,
        entered_by_user_id: "u",
        entered_at: "2026-05-01",
      },
    });
    const out = await recordEntry(sb, "22222222-2222-4222-8222-222222222222", {
      orgId: "11111111-1111-4111-8111-111111111111",
      entryType: "topup",
      amountCoins: 500,
    });
    expect(out.direction).toBe("credit");
    expect(out.balance_after_coins).toBe(1500);
  });

  it("fine_deduction debits balance", async () => {
    const { sb } = mockSb({
      org: { id: "11111111-1111-4111-8111-111111111111", caution_fee_balance_coins: 50000, deleted_at: null },
      insertedEntry: {
        id: "e",
        organization_id: "11111111-1111-4111-8111-111111111111",
        entry_type: "fine_deduction",
        amount_coins: 5000,
        direction: "debit",
        balance_after_coins: 45000,
        reference: "fine ref",
        entered_by_user_id: "u",
        entered_at: "2026-05-01",
      },
    });
    const out = await recordEntry(sb, "u", {
      orgId: "11111111-1111-4111-8111-111111111111",
      entryType: "fine_deduction",
      amountCoins: 5000,
      reference: "fine ref",
    });
    expect(out.direction).toBe("debit");
    expect(out.balance_after_coins).toBe(45000);
  });

  it("adjustment requires explicit direction", async () => {
    const { sb } = mockSb({
      org: { id: "11111111-1111-4111-8111-111111111111", caution_fee_balance_coins: 100, deleted_at: null },
    });
    await expect(
      recordEntry(sb, "u", {
        orgId: "11111111-1111-4111-8111-111111111111",
        entryType: "adjustment",
        amountCoins: 10,
      }),
    ).rejects.toThrow(/direction/);
  });

  it("adjustment credit works", async () => {
    const { sb } = mockSb({
      org: { id: "11111111-1111-4111-8111-111111111111", caution_fee_balance_coins: 100, deleted_at: null },
      insertedEntry: {
        id: "e",
        organization_id: "11111111-1111-4111-8111-111111111111",
        entry_type: "adjustment",
        amount_coins: 25,
        direction: "credit",
        balance_after_coins: 125,
        reference: null,
        entered_by_user_id: "u",
        entered_at: "x",
      },
    });
    const out = await recordEntry(sb, "u", {
      orgId: "11111111-1111-4111-8111-111111111111",
      entryType: "adjustment",
      amountCoins: 25,
      direction: "credit",
    });
    expect(out.balance_after_coins).toBe(125);
  });

  it("adjustment debit works", async () => {
    const { sb } = mockSb({
      org: { id: "11111111-1111-4111-8111-111111111111", caution_fee_balance_coins: 100, deleted_at: null },
      insertedEntry: {
        id: "e",
        organization_id: "11111111-1111-4111-8111-111111111111",
        entry_type: "adjustment",
        amount_coins: 25,
        direction: "debit",
        balance_after_coins: 75,
        reference: null,
        entered_by_user_id: "u",
        entered_at: "x",
      },
    });
    const out = await recordEntry(sb, "u", {
      orgId: "11111111-1111-4111-8111-111111111111",
      entryType: "adjustment",
      amountCoins: 25,
      direction: "debit",
    });
    expect(out.balance_after_coins).toBe(75);
  });

  it("overdraft rejected (balance would go negative)", async () => {
    const { sb } = mockSb({
      org: { id: "11111111-1111-4111-8111-111111111111", caution_fee_balance_coins: 100, deleted_at: null },
    });
    await expect(
      recordEntry(sb, "u", {
        orgId: "11111111-1111-4111-8111-111111111111",
        entryType: "fine_deduction",
        amountCoins: 500,
      }),
    ).rejects.toThrow(/overdraft/i);
  });

  it("missing org throws", async () => {
    const { sb } = mockSb({ org: null });
    await expect(
      recordEntry(sb, "u", {
        orgId: "00000000-0000-0000-0000-000000000000",
        entryType: "deposit",
        amountCoins: 1,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("deleted org blocks posting", async () => {
    const { sb } = mockSb({
      org: {
        id: "11111111-1111-4111-8111-111111111111",
        caution_fee_balance_coins: 100,
        deleted_at: "2026-01-01T00:00:00Z",
      },
    });
    await expect(
      recordEntry(sb, "u", {
        orgId: "11111111-1111-4111-8111-111111111111",
        entryType: "deposit",
        amountCoins: 1,
      }),
    ).rejects.toThrow(/deleted/i);
  });

  it("zero or negative amount rejected by zod", async () => {
    const { sb } = mockSb({
      org: { id: "11111111-1111-4111-8111-111111111111", caution_fee_balance_coins: 100, deleted_at: null },
    });
    await expect(
      recordEntry(sb, "u", {
        orgId: "11111111-1111-4111-8111-111111111111",
        entryType: "deposit",
        amountCoins: 0,
      }),
    ).rejects.toThrow();
  });

  it("LedgerError is thrown for ledger insert failures", async () => {
    const { sb } = mockSb({
      org: { id: "11111111-1111-4111-8111-111111111111", caution_fee_balance_coins: 0, deleted_at: null },
      insertErr: { message: "dup key" },
    });
    await expect(
      recordEntry(sb, "u", {
        orgId: "11111111-1111-4111-8111-111111111111",
        entryType: "deposit",
        amountCoins: 10,
      }),
    ).rejects.toBeInstanceOf(LedgerError);
  });
});

describe("getBalance", () => {
  it("returns the stored balance", async () => {
    const { sb } = mockSb({
      org: { id: "11111111-1111-4111-8111-111111111111", caution_fee_balance_coins: 12345, deleted_at: null },
    });
    const b = await getBalance(sb, "11111111-1111-4111-8111-111111111111");
    expect(b).toBe(12345);
  });

  it("throws on missing org", async () => {
    const { sb } = mockSb({ org: null });
    await expect(
      getBalance(sb, "99999999-9999-4999-8999-999999999999"),
    ).rejects.toThrow(/not found/);
  });
});
