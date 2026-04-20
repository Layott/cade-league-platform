import { describe, it, expect, vi } from "vitest";
import { listDeleted, restore } from "./index";

function mkListSb(rows: Array<Record<string, unknown>>, error: unknown = null) {
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      not: vi.fn(() => ({
        order: vi.fn().mockResolvedValue({ data: rows, error }),
      })),
    })),
  }));
  return { from };
}

function mkRestoreSb() {
  const eq = vi.fn().mockResolvedValue({ error: null, data: [{ id: "x" }] });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { from, update, eq };
}

describe("listDeleted", () => {
  it("throws on unknown entity type (guards against string interpolation)", async () => {
    const sb = mkListSb([]);
    await expect(
      listDeleted(sb as never, "users; drop table users;--")
    ).rejects.toThrow(/unknown entity/i);
  });

  it("queries the mapped table for a valid entity", async () => {
    const sb = mkListSb([
      { id: "p1", gamer_tag: "Keanu", deleted_at: "2026-04-26" },
    ]);
    const res = await listDeleted(sb as never, "players");
    expect(sb.from).toHaveBeenCalledWith("players");
    expect(res.missingTable).toBe(false);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ gamer_tag: "Keanu" });
  });

  it("maps 'punishments' slug to disciplinary_actions table", async () => {
    const sb = mkListSb([]);
    await listDeleted(sb as never, "punishments");
    expect(sb.from).toHaveBeenCalledWith("disciplinary_actions");
  });

  it("returns { missingTable: true } when table does not exist (42P01)", async () => {
    const sb = mkListSb([], {
      code: "42P01",
      message: 'relation "public.announcements" does not exist',
    });
    const res = await listDeleted(sb as never, "announcements");
    expect(res.missingTable).toBe(true);
    expect(res.rows).toEqual([]);
  });

  it("rethrows non-42P01 errors", async () => {
    const sb = mkListSb([], { code: "42501", message: "permission denied" });
    await expect(listDeleted(sb as never, "players")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("returns empty rows when data is null and no error", async () => {
    const sb = mkListSb(null as never);
    const res = await listDeleted(sb as never, "users");
    expect(res.rows).toEqual([]);
    expect(res.missingTable).toBe(false);
  });
});

describe("restore", () => {
  it("throws on unknown entity type", async () => {
    const sb = mkRestoreSb();
    await expect(
      restore(sb as never, "not_a_table", "id-1", "actor-1")
    ).rejects.toThrow(/unknown entity/i);
  });

  it("throws on empty id", async () => {
    const sb = mkRestoreSb();
    await expect(
      restore(sb as never, "players", "", "actor-1")
    ).rejects.toThrow(/id required/i);
  });

  it("throws on whitespace-only id", async () => {
    const sb = mkRestoreSb();
    await expect(
      restore(sb as never, "players", "   ", "actor-1")
    ).rejects.toThrow(/id required/i);
  });

  it("updates mapped table setting deleted_at to null", async () => {
    const sb = mkRestoreSb();
    await restore(sb as never, "punishments", "pu-1", "actor-1");
    expect(sb.from).toHaveBeenCalledWith("disciplinary_actions");
    expect(sb.update).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: null })
    );
    expect(sb.eq).toHaveBeenCalledWith("id", "pu-1");
  });

  it("rethrows underlying DB errors", async () => {
    const eq = vi
      .fn()
      .mockResolvedValue({ error: { code: "42501", message: "denied" } });
    const update = vi.fn(() => ({ eq }));
    const sb = { from: vi.fn(() => ({ update })) };
    await expect(
      restore(sb as never, "players", "p1", "actor-1")
    ).rejects.toMatchObject({ code: "42501" });
  });
});
