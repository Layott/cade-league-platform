import { describe, it, expect, vi, beforeEach } from "vitest";

const { publishMock } = vi.hoisted(() => ({
  publishMock: vi.fn().mockResolvedValue("ok"),
}));
vi.mock("@/server/broadcast/realtime", () => ({ publish: publishMock }));

import {
  triggerInstance,
  updateInstancePayload,
  listActiveInstances,
} from "./instances";

const goodLowerThird = {
  playerId: "11111111-1111-4111-8111-111111111111",
  displayName: "Rhymez",
  gamerTag: "RHYMEZ_FC",
  jerseyNumber: 10,
};

function instancesTable(opts: {
  insertId?: string;
  selectRow?: Record<string, unknown> | null;
  list?: Array<Record<string, unknown>>;
}) {
  const insertSingle = vi
    .fn()
    .mockResolvedValue({ data: { id: opts.insertId ?? "inst-1" }, error: null });
  const updateOk = vi.fn().mockResolvedValue({ error: null });
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.selectRow ?? null, error: null });
  // For list query: ...select(...).eq(...).is(...).is(...).order(...) → resolves
  const listOrder = vi
    .fn()
    .mockResolvedValue({ data: opts.list ?? [], error: null });

  return {
    insert: vi.fn(() => ({ select: vi.fn(() => ({ single: insertSingle })) })),
    update: vi.fn(() => {
      // chain: .update(...).eq(...).eq(...).eq(...).is(...).is(...) returns Promise
      // OR     .update(...).eq(...) for clearInstance
      const eqChain = vi.fn();
      const isChain = vi.fn();
      eqChain.mockImplementation(() => ({ eq: eqChain, is: isChain }));
      isChain.mockImplementation(() => ({ is: () => updateOk(), then: updateOk }));
      // Make the terminal call resolve
      return {
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({ is: updateOk })),
            })),
          })),
          is: vi.fn(() => updateOk()),
        })),
      };
    }),
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            is: vi.fn(() => ({
              order: listOrder,
              maybeSingle,
            })),
          })),
        })),
        is: vi.fn(() => ({
          is: vi.fn(() => ({
            order: listOrder,
            maybeSingle,
          })),
          maybeSingle,
        })),
      })),
    })),
    _spies: { insertSingle, updateOk, maybeSingle, listOrder },
  };
}

function mkSb(table: ReturnType<typeof instancesTable>) {
  return { from: vi.fn(() => table) };
}

describe("triggerInstance", () => {
  beforeEach(() => publishMock.mockClear());

  it("rejects slots outside 1..3", async () => {
    const t = instancesTable({});
    await expect(
      triggerInstance(mkSb(t) as never, {
        sessionId: "s",
        templateKey: "lower_third",
        instanceSlot: 4,
        payload: goodLowerThird,
        userId: "u",
      }),
    ).rejects.toThrow(/instanceSlot/);
    await expect(
      triggerInstance(mkSb(t) as never, {
        sessionId: "s",
        templateKey: "lower_third",
        instanceSlot: 0,
        payload: goodLowerThird,
        userId: "u",
      }),
    ).rejects.toThrow(/instanceSlot/);
  });

  it("clears any existing same-slot live row before inserting + publishes", async () => {
    const t = instancesTable({ insertId: "inst-2" });
    const out = await triggerInstance(mkSb(t) as never, {
      sessionId: "s",
      templateKey: "lower_third",
      instanceSlot: 2,
      payload: goodLowerThird,
      userId: "u",
    });
    expect(out).toEqual({ id: "inst-2" });
    // update was called for the prior-slot clear
    expect(t.update).toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      "s",
      "instance.triggered",
      expect.objectContaining({
        instanceId: "inst-2",
        instanceSlot: 2,
        templateKey: "lower_third",
      }),
    );
  });

  it("rejects unknown templateKey", async () => {
    const t = instancesTable({});
    await expect(
      triggerInstance(mkSb(t) as never, {
        sessionId: "s",
        templateKey: "nope",
        instanceSlot: 1,
        payload: {},
        userId: "u",
      }),
    ).rejects.toThrow(/unknown templateKey/);
  });
});

describe("updateInstancePayload", () => {
  beforeEach(() => publishMock.mockClear());

  it("republishes instance.triggered with same instanceId (no new id)", async () => {
    const t = instancesTable({
      selectRow: {
        id: "inst-1",
        stream_session_id: "s",
        template_key: "lower_third",
        instance_slot: 1,
      },
    });
    await updateInstancePayload(
      mkSb(t) as never,
      "inst-1",
      goodLowerThird,
      "u",
    );
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      "s",
      "instance.triggered",
      expect.objectContaining({
        instanceId: "inst-1",
        instanceSlot: 1,
      }),
    );
  });

  it("throws when no active instance found", async () => {
    const t = instancesTable({ selectRow: null });
    await expect(
      updateInstancePayload(mkSb(t) as never, "missing", goodLowerThird, "u"),
    ).rejects.toThrow(/active instance not found/);
  });
});

describe("listActiveInstances", () => {
  it("returns mapped rows ordered by slot", async () => {
    const t = instancesTable({
      list: [
        {
          id: "i1",
          stream_session_id: "s",
          template_key: "lower_third",
          instance_slot: 1,
          payload: { displayName: "A" },
          triggered_at: "2026-04-22T00:00:00Z",
          cleared_at: null,
          triggered_by: "u",
        },
      ],
    });
    const out = await listActiveInstances(mkSb(t) as never, "s", "lower_third");
    expect(out).toHaveLength(1);
    expect(out[0].instanceSlot).toBe(1);
    expect(out[0].id).toBe("i1");
  });
});
