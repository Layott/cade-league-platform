import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createJob,
  getJob,
  listRecentJobs,
  approveJob,
  softDeleteJob,
  updateJobStatus,
} from "./jobs";
import { __test as rolesCacheTest } from "@/server/roles/cache";

/**
 * Plan 54 Wave 1C — unit tests for `social/jobs.ts`.
 *
 * The perm gate (`requirePermAsync`) flows off the actor.roles list against
 * `PUBLIC_PERMS` + `role_permissions` rows. We mock `role_permissions` to
 * either grant or deny the social.* perms per test. The DB cache for the
 * 'admin' role honours wildcard '*' — we exploit that to grant everything
 * with one mocked row, mirroring how prod runs.
 *
 * For the actual table CRUD we provide chained mocks that capture the
 * insert/update payload + return the requested shape on `.single()` /
 * `.maybeSingle()`.
 */

const ADMIN_ID = "admin-1111-1111-1111-111111111111";
const JOB_ID = "jjjj-1111-1111-1111-111111111111";

function adminActor() {
  return { userId: ADMIN_ID, roles: ["admin"] };
}

function viewerActor() {
  return { userId: "v1", roles: ["viewer"] };
}

/**
 * Build a mock SupabaseClient where `from(table)` dispatches to a per-table
 * handler the test caller supplies. The `role_permissions` table always
 * returns the wildcard '*' rule for the admin role and an empty list for
 * everything else, so tests don't need to wire it up per case.
 */
type ChainConfig = {
  /** Resolves the FINAL `.single()` / `.maybeSingle()` of an insert/select */
  finalSingle?: { data: unknown; error: Error | null };
  /** Resolves a list-shaped read (`.limit().then(...)` / awaited query) */
  finalList?: { data: unknown; error: Error | null };
  /** Resolves an update (no `.select()` after) */
  finalUpdate?: { error: Error | null };
  /** Captures the insert payload for assertion */
  capturedInsert?: Record<string, unknown>;
  /** Captures the update patch for assertion */
  capturedUpdate?: Record<string, unknown>;
};

function makeChain(cfg: ChainConfig) {
  // The CRUD chains we have to model:
  //   insert(payload).select(cols).single()        → finalSingle
  //   select(cols).eq().is().maybeSingle()         → finalSingle
  //   select(cols).is().order().limit()            → finalList (awaitable)
  //   update(patch).eq().is()                       → finalUpdate (awaitable)
  const api: Record<string, unknown> = {};

  const updateThenable = cfg.finalUpdate
    ? Promise.resolve({ data: null, error: cfg.finalUpdate.error })
    : Promise.resolve({ data: null, error: null });
  const listThenable = cfg.finalList
    ? Promise.resolve(cfg.finalList)
    : Promise.resolve({ data: [], error: null });

  api.insert = vi.fn((payload: Record<string, unknown>) => {
    cfg.capturedInsert = payload;
    return api;
  });
  api.update = vi.fn((patch: Record<string, unknown>) => {
    cfg.capturedUpdate = patch;
    return api;
  });
  api.select = vi.fn(() => api);
  api.eq = vi.fn(() => api);
  api.is = vi.fn(() => api);
  api.order = vi.fn(() => api);
  api.limit = vi.fn(() => api);

  // single() / maybeSingle() resolve to the `finalSingle` cfg.
  api.single = vi.fn(() =>
    cfg.finalSingle
      ? Promise.resolve(cfg.finalSingle)
      : Promise.resolve({ data: null, error: null }),
  );
  api.maybeSingle = vi.fn(() =>
    cfg.finalSingle
      ? Promise.resolve(cfg.finalSingle)
      : Promise.resolve({ data: null, error: null }),
  );

  // For list reads (no terminal call) the chain itself must be thenable.
  // For update reads (also no terminal call) the chain must resolve too.
  // We want the SAME chain object to satisfy both — the test config
  // determines which result it returns by setting finalList xor finalUpdate.
  (api as { then?: unknown }).then = (
    onFulfilled: (v: unknown) => unknown,
  ) =>
    cfg.finalList !== undefined
      ? listThenable.then(onFulfilled)
      : updateThenable.then(onFulfilled);

  return api;
}

/**
 * Stub `role_permissions` table. The cache module's reader selects the
 * `permission` column (not `rule`) and projects it to a string list. Admin
 * role gets '*' (wildcard pass); other roles get an empty list.
 *
 * The 30s TTL is bypassed in `beforeEach` via `__test.clearAll()`.
 */
function rolePermsHandler(role: string) {
  const data = role === "admin" ? [{ permission: "*" }] : [];
  return makeChain({ finalList: { data, error: null } });
}

function mkSb(handlers: Record<string, ReturnType<typeof makeChain>>) {
  return {
    from: vi.fn((t: string) => {
      // role_permissions reads happen at every requirePermAsync call.
      if (t === "role_permissions") {
        // Assume admin unless test explicitly overrode it — mkSb() callers
        // can pass their own `role_permissions` chain to deny.
        return handlers.role_permissions ?? rolePermsHandler("admin");
      }
      const h = handlers[t];
      if (!h) {
        throw new Error(`unexpected table read in test: ${t}`);
      }
      return h;
    }),
  };
}

/**
 * Plan 9 — `getRolePerms` caches per-role for 30s. Clear between tests so
 * the stubbed `role_permissions` chain is re-read each call.
 */
beforeEach(() => {
  rolesCacheTest.clearAll();
});

/* ------------------------------------------------------------------ *
 * createJob                                                           *
 * ------------------------------------------------------------------ */

describe("createJob", () => {
  it("inserts row with correct snake_case fields and returns id", async () => {
    const insertChain = makeChain({
      finalSingle: { data: { id: JOB_ID }, error: null },
    });
    const sb = mkSb({ social_render_jobs: insertChain });
    const out = await createJob(sb as never, adminActor(), {
      templateKey: "leaderboard",
      size: "1080x1920",
      format: "image",
      sourceData: { foo: "bar" },
      seasonId: "11111111-1111-4111-8111-111111111111",
      matchDayId: "22222222-2222-4222-8222-222222222222",
    });
    expect(out.id).toBe(JOB_ID);
    expect(insertChain.insert).toHaveBeenCalledTimes(1);
    const captured = (
      (insertChain as unknown as { insert: { mock: { calls: unknown[][] } } })
        .insert.mock.calls[0][0]
    ) as Record<string, unknown>;
    expect(captured.template_key).toBe("leaderboard");
    expect(captured.size).toBe("1080x1920");
    expect(captured.format).toBe("image");
    expect(captured.status).toBe("pending");
    expect(captured.requested_by).toBe(ADMIN_ID);
    expect(captured.season_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(captured.source_data).toEqual({ foo: "bar" });
  });

  it("fails when actor lacks social.render", async () => {
    const sb = mkSb({
      role_permissions: rolePermsHandler("viewer"),
    });
    await expect(
      createJob(sb as never, viewerActor(), {
        templateKey: "leaderboard",
        size: "1080x1920",
        format: "image",
        sourceData: {},
      }),
    ).rejects.toThrow(/missing permission: social\.render/);
  });

  it("rejects malformed templateKey", async () => {
    const sb = mkSb({
      social_render_jobs: makeChain({
        finalSingle: { data: { id: JOB_ID }, error: null },
      }),
    });
    await expect(
      createJob(sb as never, adminActor(), {
        // @ts-expect-error — testing runtime guard
        templateKey: "not-a-template",
        size: "1080x1920",
        format: "image",
        sourceData: {},
      }),
    ).rejects.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * listRecentJobs                                                      *
 * ------------------------------------------------------------------ */

describe("listRecentJobs", () => {
  it("returns jobs and excludes soft-deleted via .is(deleted_at, null)", async () => {
    const rows = [
      {
        id: "j1",
        template_key: "leaderboard",
        size: "1080x1920",
        format: "image",
        source_data: {},
        season_id: null,
        match_day_id: null,
        status: "ready",
        output_url: "https://example.com/x.png",
        output_size_bytes: 1234,
        error_message: null,
        duration_ms: 800,
        requested_by: ADMIN_ID,
        approved_by: null,
        approved_at: null,
        posted_marker: null,
        created_at: "2026-05-04T12:00:00Z",
        updated_at: "2026-05-04T12:00:30Z",
        deleted_at: null,
      },
    ];
    const listChain = makeChain({ finalList: { data: rows, error: null } });
    const sb = mkSb({ social_render_jobs: listChain });
    const out = await listRecentJobs(sb as never, adminActor(), 50);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("j1");
    expect(out[0].status).toBe("ready");
    expect(listChain.is).toHaveBeenCalledWith("deleted_at", null);
    expect(listChain.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
  });

  it("clamps the limit to 200", async () => {
    const listChain = makeChain({ finalList: { data: [], error: null } });
    const sb = mkSb({ social_render_jobs: listChain });
    await listRecentJobs(sb as never, adminActor(), 500);
    expect(listChain.limit).toHaveBeenCalledWith(200);
  });
});

/* ------------------------------------------------------------------ *
 * getJob                                                              *
 * ------------------------------------------------------------------ */

describe("getJob", () => {
  it("returns mapped job when row exists", async () => {
    const row = {
      id: JOB_ID,
      template_key: "top-scorers",
      size: "1080x1080",
      format: "image",
      source_data: { rows: [] },
      season_id: null,
      match_day_id: null,
      status: "rendering",
      output_url: null,
      output_size_bytes: null,
      error_message: null,
      duration_ms: null,
      requested_by: ADMIN_ID,
      approved_by: null,
      approved_at: null,
      posted_marker: null,
      created_at: "2026-05-04T12:00:00Z",
      updated_at: "2026-05-04T12:00:00Z",
      deleted_at: null,
    };
    const getChain = makeChain({ finalSingle: { data: row, error: null } });
    const sb = mkSb({ social_render_jobs: getChain });
    const out = await getJob(sb as never, adminActor(), JOB_ID);
    expect(out?.id).toBe(JOB_ID);
    expect(out?.templateKey).toBe("top-scorers");
    expect(out?.status).toBe("rendering");
  });

  it("returns null when no row found", async () => {
    const getChain = makeChain({
      finalSingle: { data: null, error: null },
    });
    const sb = mkSb({ social_render_jobs: getChain });
    const out = await getJob(sb as never, adminActor(), "nonexistent");
    expect(out).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * approveJob                                                          *
 * ------------------------------------------------------------------ */

describe("approveJob", () => {
  it("sets approved_by + approved_at to current actor + now", async () => {
    const approveChain = makeChain({ finalUpdate: { error: null } });
    const sb = mkSb({ social_render_jobs: approveChain });
    await approveJob(sb as never, adminActor(), JOB_ID);
    expect(approveChain.update).toHaveBeenCalledTimes(1);
    const patch = (
      (approveChain as unknown as { update: { mock: { calls: unknown[][] } } })
        .update.mock.calls[0][0]
    ) as Record<string, unknown>;
    expect(patch.approved_by).toBe(ADMIN_ID);
    expect(typeof patch.approved_at).toBe("string");
    expect((patch.approved_at as string).endsWith("Z")).toBe(true);
    expect(approveChain.eq).toHaveBeenCalledWith("id", JOB_ID);
    expect(approveChain.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("throws when actor has no userId", async () => {
    const sb = mkSb({});
    await expect(
      approveJob(sb as never, { userId: null, roles: ["admin"] }, JOB_ID),
    ).rejects.toThrow(/authenticated actor/);
  });
});

/* ------------------------------------------------------------------ *
 * softDeleteJob                                                       *
 * ------------------------------------------------------------------ */

describe("softDeleteJob", () => {
  it("sets deleted_at + updated_at, never DELETEs the row", async () => {
    const delChain = makeChain({ finalUpdate: { error: null } });
    const sb = mkSb({ social_render_jobs: delChain });
    await softDeleteJob(sb as never, adminActor(), JOB_ID);
    expect(delChain.update).toHaveBeenCalledTimes(1);
    const patch = (
      (delChain as unknown as { update: { mock: { calls: unknown[][] } } })
        .update.mock.calls[0][0]
    ) as Record<string, unknown>;
    expect(typeof patch.deleted_at).toBe("string");
    expect(typeof patch.updated_at).toBe("string");
    // Sanity: the chain never called `.delete()` (no such method on our mock,
    // and absence is the test). It only ever calls update(...).
    expect(
      (delChain as Record<string, unknown>).delete as unknown,
    ).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * updateJobStatus                                                     *
 * ------------------------------------------------------------------ */

describe("updateJobStatus", () => {
  it("merges extras and writes status atomically", async () => {
    const upChain = makeChain({ finalUpdate: { error: null } });
    const sb = mkSb({ social_render_jobs: upChain });
    await updateJobStatus(sb as never, adminActor(), JOB_ID, "ready", {
      outputUrl: "https://example.com/asset.png",
      outputSizeBytes: 5432,
      durationMs: 750,
    });
    const patch = (
      (upChain as unknown as { update: { mock: { calls: unknown[][] } } })
        .update.mock.calls[0][0]
    ) as Record<string, unknown>;
    expect(patch.status).toBe("ready");
    expect(patch.output_url).toBe("https://example.com/asset.png");
    expect(patch.output_size_bytes).toBe(5432);
    expect(patch.duration_ms).toBe(750);
    expect(typeof patch.updated_at).toBe("string");
  });

  it("writes only status when no extras provided", async () => {
    const upChain = makeChain({ finalUpdate: { error: null } });
    const sb = mkSb({ social_render_jobs: upChain });
    await updateJobStatus(sb as never, adminActor(), JOB_ID, "rendering");
    const patch = (
      (upChain as unknown as { update: { mock: { calls: unknown[][] } } })
        .update.mock.calls[0][0]
    ) as Record<string, unknown>;
    expect(patch.status).toBe("rendering");
    expect(patch.output_url).toBeUndefined();
    expect(patch.output_size_bytes).toBeUndefined();
  });
});
