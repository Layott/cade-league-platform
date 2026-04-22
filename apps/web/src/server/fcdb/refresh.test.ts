import { describe, expect, it, vi } from "vitest";
import { refresh } from "./refresh";
import type { NormalizedFCRow, SourceResult } from "./sources/types";

function mkRow(over: Partial<NormalizedFCRow> = {}): NormalizedFCRow {
  return {
    source_dataset: "futdb.co",
    source_row_id: "1",
    name: "Test",
    slug: "test",
    rating: 80,
    position: "ST",
    alt_positions: null,
    club: null,
    league: null,
    nation: null,
    item_type: "normal",
    value_coins_estimate: null,
    attributes: {},
    ...over,
  };
}

/**
 * Mock Supabase client that records every insert/upsert call + optionally
 * returns an error on a given call.
 */
function mkSb(opts: { upsertErr?: string; insertErr?: string } = {}) {
  const upsertCalls: unknown[][] = [];
  const insertCalls: unknown[][] = [];

  const upsertFn = vi.fn(async (rows: unknown[]) => {
    upsertCalls.push(rows);
    return { error: opts.upsertErr ? { message: opts.upsertErr } : null };
  });
  const insertFn = vi.fn(async (row: unknown) => {
    insertCalls.push([row]);
    return { error: opts.insertErr ? { message: opts.insertErr } : null };
  });

  const sb = {
    from: (table: string) => {
      if (table === "fc26_players") {
        return {
          upsert: (rows: unknown[]) => upsertFn(rows),
        };
      }
      if (table === "fc26_refresh_log") {
        return {
          insert: (row: unknown) => insertFn(row),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return { sb, upsertCalls, insertCalls, upsertFn, insertFn };
}

describe("refresh orchestrator", () => {
  it("picks the first source that returns rows + logs + upserts", async () => {
    const { sb, upsertCalls, insertCalls } = mkSb();
    const futdb = vi.fn<() => Promise<SourceResult>>(async () => ({
      source: "futdb",
      rows: [mkRow({ source_row_id: "1" }), mkRow({ source_row_id: "2" })],
    }));
    const sofifa = vi.fn<() => Promise<SourceResult>>(async () => ({
      source: "sofifa",
      rows: [],
    }));
    const out = await refresh(sb as never, {
      sources: [
        async () => ({ skipped: true, source: "kaggle", reason: "no token" }),
        futdb,
        sofifa,
      ],
    });
    expect(out.source).toBe("futdb");
    expect(out.rows_upserted).toBe(2);
    expect(out.rows_failed).toBe(0);
    // futdb produced → sofifa NOT called.
    expect(sofifa).not.toHaveBeenCalled();
    expect(upsertCalls).toHaveLength(1);
    expect((upsertCalls[0] as unknown[])[0]).toMatchObject({ source_row_id: "1" });
    // Log row written.
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0][0]).toMatchObject({
      source: "futdb",
      rows_upserted: 2,
      rows_failed: 0,
    });
  });

  it("falls through when first source is skipped", async () => {
    const { sb } = mkSb();
    const futdb = vi.fn<() => Promise<SourceResult>>(async () => ({
      source: "futdb",
      rows: [mkRow()],
    }));
    const out = await refresh(sb as never, {
      sources: [
        async () => ({ skipped: true, source: "kaggle", reason: "no CLI" }),
        futdb,
      ],
    });
    expect(futdb).toHaveBeenCalledOnce();
    expect(out.source).toBe("futdb");
    expect(out.rows_upserted).toBe(1);
  });

  it("falls through when a source returns 0 rows", async () => {
    const { sb } = mkSb();
    const futdb = vi.fn<() => Promise<SourceResult>>(async () => ({
      source: "futdb",
      rows: [],
    }));
    const sofifa = vi.fn<() => Promise<SourceResult>>(async () => ({
      source: "sofifa",
      rows: [mkRow({ source_dataset: "sofifa.com" })],
    }));
    const out = await refresh(sb as never, {
      sources: [futdb, sofifa],
    });
    expect(sofifa).toHaveBeenCalledOnce();
    expect(out.source).toBe("sofifa");
    expect(out.rows_upserted).toBe(1);
  });

  it("falls through when a source throws", async () => {
    const { sb, insertCalls } = mkSb();
    const out = await refresh(sb as never, {
      sources: [
        async () => {
          throw new Error("network down");
        },
        async () => ({ source: "sofifa", rows: [mkRow()] }),
      ],
    });
    expect(out.source).toBe("sofifa");
    expect(out.rows_upserted).toBe(1);
    // The throw should have been preserved in error summary as a soft note.
    const logged = insertCalls[0][0] as { error?: string | null };
    expect(logged.error ?? "").toMatch(/network down/);
  });

  it("logs source='none' + error when every source is skipped", async () => {
    const { sb, insertCalls, upsertFn } = mkSb();
    const out = await refresh(sb as never, {
      sources: [
        async () => ({ skipped: true, source: "kaggle", reason: "no token" }),
        async () => ({ skipped: true, source: "futdb", reason: "no key" }),
        async () => ({ skipped: true, source: "sofifa", reason: "0 rows parsed" }),
      ],
    });
    expect(out.source).toBe("none");
    expect(out.rows_upserted).toBe(0);
    expect(out.error).toMatch(/kaggle/);
    expect(out.error).toMatch(/futdb/);
    // No upsert attempted when zero rows selected.
    expect(upsertFn).not.toHaveBeenCalled();
    // Still wrote one log row with source='none'.
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0][0]).toMatchObject({ source: "none" });
  });

  it("records rows_failed + firstError when Supabase upsert rejects", async () => {
    const { sb, insertCalls } = mkSb({ upsertErr: "unique violation" });
    const out = await refresh(sb as never, {
      sources: [async () => ({ source: "futdb", rows: [mkRow(), mkRow({ source_row_id: "2" })] })],
    });
    expect(out.rows_upserted).toBe(0);
    expect(out.rows_failed).toBe(2);
    expect(out.error).toMatch(/unique violation/);
    expect(insertCalls[0][0]).toMatchObject({ rows_failed: 2 });
  });

  it("computes duration_ms from injected clock", async () => {
    const { sb } = mkSb();
    let t = 1000;
    const out = await refresh(sb as never, {
      sources: [async () => ({ source: "futdb", rows: [mkRow()] })],
      now: () => {
        const cur = t;
        t += 125;
        return cur;
      },
    });
    // Start=1000, after source+upsert=1125. duration = 125.
    expect(out.duration_ms).toBeGreaterThanOrEqual(125);
  });
});
