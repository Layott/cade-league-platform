import { describe, it, expect, vi, beforeEach } from "vitest";

const { triggerOverlayMock, triggerInstanceMock } = vi.hoisted(() => ({
  triggerOverlayMock: vi.fn().mockResolvedValue({ id: "ev-1" }),
  triggerInstanceMock: vi.fn().mockResolvedValue({ id: "inst-1" }),
}));
vi.mock("@/server/broadcast/events", () => ({
  triggerOverlay: triggerOverlayMock,
}));
vi.mock("./instances", () => ({
  triggerInstance: triggerInstanceMock,
}));

import {
  createPreset,
  updatePreset,
  deletePreset,
  loadPresetIntoEvent,
} from "./presets";

type Maybe<T> = { data: T | null; error: null | { message: string } };

function presetsTable(handlers: {
  insertSingle?: () => Promise<Maybe<{ id: string }>>;
  updateOk?: () => Promise<{ error: null }>;
  selectOne?: () => Promise<Maybe<Record<string, unknown>>>;
}) {
  const insertSingle = vi
    .fn()
    .mockImplementation(handlers.insertSingle ?? (async () => ({ data: { id: "p-1" }, error: null })));
  const updateRet = vi
    .fn()
    .mockImplementation(handlers.updateOk ?? (async () => ({ error: null })));
  const maybeSingle = vi
    .fn()
    .mockImplementation(handlers.selectOne ?? (async () => ({ data: null, error: null })));

  return {
    insert: vi.fn(() => ({ select: vi.fn(() => ({ single: insertSingle })) })),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({ is: updateRet })),
    })),
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({ maybeSingle })),
      })),
    })),
    _spies: { insertSingle, updateRet, maybeSingle },
  };
}

function mkSb(table: ReturnType<typeof presetsTable>) {
  return { from: vi.fn(() => table) };
}

describe("createPreset", () => {
  beforeEach(() => {
    triggerOverlayMock.mockClear();
    triggerInstanceMock.mockClear();
  });

  it("Zod-rejects invalid payload before insert", async () => {
    const t = presetsTable({});
    await expect(
      createPreset(mkSb(t) as never, {
        templateKey: "lower_third",
        label: "Bad",
        payload: { displayName: "x" }, // missing playerId, gamerTag, jerseyNumber
        userId: "u",
      }),
    ).rejects.toThrow();
    expect(t._spies.insertSingle).not.toHaveBeenCalled();
  });

  it("inserts row on valid payload + label trimmed", async () => {
    const t = presetsTable({
      insertSingle: async () => ({ data: { id: "p-1" }, error: null }),
    });
    const out = await createPreset(mkSb(t) as never, {
      templateKey: "lower_third",
      label: "  Caster · Rhymez  ",
      payload: {
        playerId: "11111111-1111-4111-8111-111111111111",
        displayName: "Rhymez",
        gamerTag: "RHYMEZ_FC",
        jerseyNumber: 10,
      },
      userId: "u-1",
    });
    expect(out).toEqual({ id: "p-1" });
    expect(t.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        template_key: "lower_third",
        label: "Caster · Rhymez",
        created_by: "u-1",
        is_default: false,
      }),
    );
  });

  it("rejects unknown templateKey", async () => {
    const t = presetsTable({});
    await expect(
      createPreset(mkSb(t) as never, {
        templateKey: "nope",
        label: "x",
        payload: {},
        userId: "u",
      }),
    ).rejects.toThrow(/unknown templateKey/);
  });
});

describe("updatePreset", () => {
  it("re-validates payload against the existing row's templateKey", async () => {
    const t = presetsTable({
      selectOne: async () => ({
        data: {
          id: "p-1",
          template_key: "lower_third",
          label: "x",
          payload: {},
          is_default: false,
          created_by: "u",
          created_at: "2026-04-22T00:00:00Z",
          updated_at: "2026-04-22T00:00:00Z",
        },
        error: null,
      }),
    });
    await expect(
      updatePreset(mkSb(t) as never, "p-1", {
        payload: { displayName: "x" }, // invalid for lower_third
        userId: "u",
      }),
    ).rejects.toThrow();
  });

  it("succeeds with label-only update (no payload re-validation needed)", async () => {
    const t = presetsTable({
      selectOne: async () => ({
        data: {
          id: "p-1",
          template_key: "lower_third",
          label: "old",
          payload: {},
          is_default: false,
          created_by: "u",
          created_at: "2026-04-22T00:00:00Z",
          updated_at: "2026-04-22T00:00:00Z",
        },
        error: null,
      }),
    });
    await expect(
      updatePreset(mkSb(t) as never, "p-1", { label: "new", userId: "u" }),
    ).resolves.toBeUndefined();
    expect(t.update).toHaveBeenCalled();
  });
});

describe("deletePreset", () => {
  it("performs a soft delete by setting deleted_at, not a hard delete", async () => {
    const t = presetsTable({});
    await deletePreset(mkSb(t) as never, "p-1", "u");
    expect(t.update).toHaveBeenCalledWith(
      expect.objectContaining({
        deleted_at: expect.any(String),
      }),
    );
  });
});

describe("loadPresetIntoEvent", () => {
  beforeEach(() => {
    triggerOverlayMock.mockClear();
    triggerInstanceMock.mockClear();
  });

  it("routes lower_third presets through triggerInstance with slot", async () => {
    const t = presetsTable({
      selectOne: async () => ({
        data: {
          id: "p-1",
          template_key: "lower_third",
          label: "x",
          payload: {
            playerId: "11111111-1111-4111-8111-111111111111",
            displayName: "Rhymez",
            gamerTag: "RHYMEZ_FC",
            jerseyNumber: 10,
          },
          is_default: false,
          created_by: "u",
          created_at: "2026-04-22T00:00:00Z",
          updated_at: "2026-04-22T00:00:00Z",
        },
        error: null,
      }),
    });
    await loadPresetIntoEvent(mkSb(t) as never, {
      presetId: "p-1",
      sessionId: "s-1",
      userId: "u-1",
      instanceSlot: 2,
    });
    expect(triggerInstanceMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: "s-1",
        templateKey: "lower_third",
        instanceSlot: 2,
        userId: "u-1",
      }),
    );
    expect(triggerOverlayMock).not.toHaveBeenCalled();
  });

  it("routes non-multi-instance templates through triggerOverlay", async () => {
    const t = presetsTable({
      selectOne: async () => ({
        data: {
          id: "p-2",
          template_key: "score_bug",
          label: "x",
          payload: {
            players: [
              { displayName: "A", score: 0 },
              { displayName: "B", score: 0 },
            ],
          },
          is_default: false,
          created_by: "u",
          created_at: "2026-04-22T00:00:00Z",
          updated_at: "2026-04-22T00:00:00Z",
        },
        error: null,
      }),
    });
    await loadPresetIntoEvent(mkSb(t) as never, {
      presetId: "p-2",
      sessionId: "s-1",
      userId: "u-1",
    });
    expect(triggerOverlayMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: "s-1",
        templateKey: "score_bug",
        userId: "u-1",
      }),
    );
    expect(triggerInstanceMock).not.toHaveBeenCalled();
  });
});
