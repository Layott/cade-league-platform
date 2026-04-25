import { describe, it, expect, vi, beforeEach } from "vitest";

// next/navigation redirect — never reached on the happy paths we test, but
// stubbed so the auth fall-through doesn't blow up.
const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    const e = new Error(`NEXT_REDIRECT;${url}`);
    (e as unknown as { digest: string }).digest = `NEXT_REDIRECT;replace;${url};303`;
    throw e;
  }),
);
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

// next/cache revalidatePath — invoked at the end of each action.
const revalidateMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

// Auth chain: server supabase yields a logged-in user → public users row
// → user_roles array. We make a small shape that matches the chained
// .from().select().eq().is/.maybeSingle pattern in the actions file.
const userClientMock = vi.hoisted(() => {
  const usersQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: { id: "pub-user-1" }, error: null }),
  };
  const rolesQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi
      .fn()
      .mockResolvedValue({ data: [{ role: "admin" }], error: null }),
  };
  return {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: "auth-user-1" } } }),
    },
    from: vi.fn((table: string) => {
      if (table === "users") return usersQuery;
      if (table === "user_roles") return rolesQuery;
      throw new Error(`unexpected table: ${table}`);
    }),
  };
});
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: () => userClientMock,
}));

// Service-role client — handed to perm + trigger fns. Just a marker object.
const serviceSb = { __serviceRoleSupabase: true };
vi.mock("@/lib/supabase/service", () => ({
  getServiceRoleSupabase: () => serviceSb,
}));

// Perms — always allow on the happy path; PermissionError is exported in
// case we want to test the deny branch later.
vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: vi.fn(async () => true),
  PermissionError: class PermissionError extends Error {},
}));

// Multi-instance gate — only `lower_third` is multi-instance. The action
// flips on this, so test both branches.
const isMultiInstanceMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/broadcast/v2/off_routing", () => ({
  isMultiInstance: isMultiInstanceMock,
}));

// Trigger / clear primitives.
const triggerOverlayMock = vi.hoisted(() => vi.fn(async () => undefined));
const clearOverlayMock = vi.hoisted(() => vi.fn(async () => undefined));
const getActiveForTemplateMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/broadcast/events", () => ({
  triggerOverlay: triggerOverlayMock,
  clearOverlay: clearOverlayMock,
  getActiveForTemplate: getActiveForTemplateMock,
}));

const triggerInstanceMock = vi.hoisted(() => vi.fn(async () => undefined));
const clearInstanceMock = vi.hoisted(() => vi.fn(async () => undefined));
const listActiveInstancesMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/overlays/instances", () => ({
  triggerInstance: triggerInstanceMock,
  clearInstance: clearInstanceMock,
  listActiveInstances: listActiveInstancesMock,
}));

/** Read the second argument from a mock's first call as a record. */
function callArg(
  mock: { mock: { calls: unknown[][] } },
): Record<string, unknown> {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("mock was not called");
  const arg = call[1] as Record<string, unknown> | undefined;
  if (!arg) throw new Error("mock call missing 2nd argument");
  return arg;
}

// v2-to-legacy template mapping — return a deterministic legacy key.
vi.mock("@/components/broadcast/v2/template-mapping", () => ({
  v2ToLegacy: vi.fn((k: string) => {
    if (k === "08-lower-third") return "lower_third";
    if (k === "04-h2h-2") return "h2h_2";
    if (k === "02-timer") return "layout_timer";
    return k;
  }),
}));

import { retriggerOverlayAction } from "./actions";

function buildForm({
  sessionId = "sess-1",
  overlayKey = "04-h2h-2",
  payload = '{"players":[{"displayName":"FARUK"}]}',
  instanceSlot,
}: {
  sessionId?: string;
  overlayKey?: string;
  payload?: string;
  instanceSlot?: number;
} = {}): FormData {
  const fd = new FormData();
  fd.set("sessionId", sessionId);
  fd.set("overlayKey", overlayKey);
  fd.set("payload", payload);
  if (typeof instanceSlot === "number") {
    fd.set("instanceSlot", String(instanceSlot));
  }
  return fd;
}

beforeEach(() => {
  redirectMock.mockClear();
  revalidateMock.mockClear();
  triggerOverlayMock.mockClear();
  clearOverlayMock.mockClear();
  getActiveForTemplateMock.mockReset();
  triggerInstanceMock.mockClear();
  clearInstanceMock.mockClear();
  listActiveInstancesMock.mockReset();
  isMultiInstanceMock.mockReset();
});

describe("retriggerOverlayAction", () => {
  describe("single-instance overlays", () => {
    beforeEach(() => {
      isMultiInstanceMock.mockReturnValue(false);
    });

    it("acts as TRIGGER when no row is currently active", async () => {
      getActiveForTemplateMock.mockResolvedValue(null);

      await retriggerOverlayAction(buildForm());

      // No clear when nothing was active
      expect(clearOverlayMock).not.toHaveBeenCalled();
      // Triggers fresh with the parsed payload
      expect(triggerOverlayMock).toHaveBeenCalledTimes(1);
      const args = callArg(triggerOverlayMock);
      expect(args.sessionId).toBe("sess-1");
      expect(args.templateKey).toBe("h2h_2");
      expect(args.payload).toEqual({
        players: [{ displayName: "FARUK" }],
      });
      expect(revalidateMock).toHaveBeenCalledWith(
        "/admin/broadcast/v2/sess-1",
      );
    });

    it("acts as CLEAR + RE-TRIGGER when a row is already active", async () => {
      getActiveForTemplateMock.mockResolvedValue({ id: "ev-active-1" });

      await retriggerOverlayAction(
        buildForm({
          payload: '{"players":[{"displayName":"ANIFE"}]}',
        }),
      );

      // Clear first, then trigger fresh — guarantees re-fired entry animation
      expect(clearOverlayMock).toHaveBeenCalledTimes(1);
      expect(clearOverlayMock).toHaveBeenCalledWith(
        serviceSb,
        "ev-active-1",
        "pub-user-1",
      );
      expect(triggerOverlayMock).toHaveBeenCalledTimes(1);
      const args = callArg(triggerOverlayMock);
      expect(args.payload).toEqual({
        players: [{ displayName: "ANIFE" }],
      });
      // Ordering: clear must precede trigger
      expect(clearOverlayMock.mock.invocationCallOrder[0]).toBeLessThan(
        triggerOverlayMock.mock.invocationCallOrder[0],
      );
    });
  });

  describe("multi-instance overlays (lower_third)", () => {
    beforeEach(() => {
      isMultiInstanceMock.mockReturnValue(true);
    });

    it("triggers fresh on the slot when no instance is active", async () => {
      listActiveInstancesMock.mockResolvedValue([]);

      await retriggerOverlayAction(
        buildForm({
          overlayKey: "08-lower-third",
          instanceSlot: 2,
          payload: '{"playerId":"00000000-0000-4000-8000-000000000002","displayName":"MILEY","gamerTag":"GUEST","jerseyNumber":2}',
        }),
      );

      expect(clearInstanceMock).not.toHaveBeenCalled();
      expect(triggerInstanceMock).toHaveBeenCalledTimes(1);
      const args = callArg(triggerInstanceMock);
      expect(args.instanceSlot).toBe(2);
      expect(args.templateKey).toBe("lower_third");
      expect((args.payload as Record<string, unknown>).displayName).toBe(
        "MILEY",
      );
    });

    it("clears the slot's active row + re-triggers when slot is active", async () => {
      listActiveInstancesMock.mockResolvedValue([
        { id: "instance-slot-2", instanceSlot: 2 },
        { id: "instance-slot-3", instanceSlot: 3 },
      ]);

      await retriggerOverlayAction(
        buildForm({
          overlayKey: "08-lower-third",
          instanceSlot: 2,
          payload: '{"playerId":"00000000-0000-4000-8000-000000000002","displayName":"MILEY","gamerTag":"GUEST","jerseyNumber":2}',
        }),
      );

      expect(clearInstanceMock).toHaveBeenCalledTimes(1);
      expect(clearInstanceMock).toHaveBeenCalledWith(
        serviceSb,
        "instance-slot-2",
        "pub-user-1",
      );
      // Slot 3 is untouched — clear is slot-targeted
      expect(triggerInstanceMock).toHaveBeenCalledTimes(1);
      const args = callArg(triggerInstanceMock);
      expect(args.instanceSlot).toBe(2);
      expect((args.payload as Record<string, unknown>).displayName).toBe(
        "MILEY",
      );
      // Ordering: clear must precede trigger
      expect(clearInstanceMock.mock.invocationCallOrder[0]).toBeLessThan(
        triggerInstanceMock.mock.invocationCallOrder[0],
      );
    });

    it("rejects an out-of-range instanceSlot", async () => {
      await expect(
        retriggerOverlayAction(
          buildForm({
            overlayKey: "08-lower-third",
            instanceSlot: 99,
          }),
        ),
      ).rejects.toThrow(/instanceSlot must be 1..3/);
    });
  });

  describe("validation", () => {
    it("rejects missing sessionId", async () => {
      const fd = buildForm();
      fd.delete("sessionId");
      await expect(retriggerOverlayAction(fd)).rejects.toThrow(
        /sessionId required/,
      );
    });

    it("rejects unknown overlay key", async () => {
      await expect(
        retriggerOverlayAction(buildForm({ overlayKey: "99-totally-fake" })),
      ).rejects.toThrow(/unknown v2 overlay key/);
    });

    it("rejects malformed payload JSON", async () => {
      isMultiInstanceMock.mockReturnValue(false);
      await expect(
        retriggerOverlayAction(
          buildForm({ payload: "{not json" }),
        ),
      ).rejects.toThrow(/payload must be valid JSON/);
    });
  });
});
