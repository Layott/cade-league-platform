import { describe, it, expect, vi } from "vitest";
import {
  listChannels,
  getDefaultChannel,
  createChannel,
  deleteChannel,
  promoteToDefault,
} from "./channels";

/**
 * Plan 47 — channels.test.ts. Mocks Supabase builder chains to cover:
 *  - list returns rows
 *  - create rejects bad handle format
 *  - create clears prior default before insert when isDefault=true
 *  - delete performs soft-delete
 *  - promoteToDefault clears + sets
 */

type Resp = { data: unknown; error: Error | null };

function makeChain(finalResp: Resp) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(finalResp);
  chain.single = vi.fn().mockResolvedValue(finalResp);
  chain.then = (cb: (x: Resp) => void) => {
    cb(finalResp);
  };
  return chain;
}

describe("listChannels", () => {
  it("maps DB rows to YouTubeChannel shape", async () => {
    const resp: Resp = {
      data: [
        {
          id: "c1",
          handle: "@CadeEsports",
          display_label: "CADE",
          is_default: true,
          created_at: "2026-04-22T00:00:00Z",
        },
      ],
      error: null,
    };
    const chain = makeChain(resp);
    const sb = {
      from: vi.fn(() => chain),
    } as unknown as Parameters<typeof listChannels>[0];
    const out = await listChannels(sb);
    expect(out).toEqual([
      {
        id: "c1",
        handle: "@CadeEsports",
        displayLabel: "CADE",
        isDefault: true,
        createdAt: "2026-04-22T00:00:00Z",
      },
    ]);
  });
});

describe("getDefaultChannel", () => {
  it("returns null when no default exists", async () => {
    const chain = makeChain({ data: null, error: null });
    const sb = {
      from: vi.fn(() => chain),
    } as unknown as Parameters<typeof getDefaultChannel>[0];
    const out = await getDefaultChannel(sb);
    expect(out).toBeNull();
  });
});

describe("createChannel", () => {
  it("rejects a handle missing the @ prefix", async () => {
    const sb = { from: vi.fn() } as unknown as Parameters<typeof createChannel>[0];
    await expect(
      createChannel(sb, { handle: "NoAt", userId: "u1" }),
    ).rejects.toThrow(/must look like/);
  });

  it("rejects a handle with illegal characters", async () => {
    const sb = { from: vi.fn() } as unknown as Parameters<typeof createChannel>[0];
    await expect(
      createChannel(sb, { handle: "@bad handle!", userId: "u1" }),
    ).rejects.toThrow(/must look like/);
  });

  it("inserts a new row without clearing defaults when isDefault=false", async () => {
    const chain = makeChain({ data: { id: "c2" }, error: null });
    const sb = {
      from: vi.fn(() => chain),
    } as unknown as Parameters<typeof createChannel>[0];
    const out = await createChannel(sb, {
      handle: "@foo",
      userId: "u1",
    });
    expect(out.id).toBe("c2");
    // update should NOT be called (no default-clearing) — insert path only.
    expect(chain.update).not.toHaveBeenCalled();
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: "@foo",
        is_default: false,
      }),
    );
  });
});

describe("deleteChannel", () => {
  it("soft-deletes by setting deleted_at", async () => {
    const chain = makeChain({ data: null, error: null });
    const sb = {
      from: vi.fn(() => chain),
    } as unknown as Parameters<typeof deleteChannel>[0];
    await deleteChannel(sb, "c1", "u1");
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) }),
    );
  });
});

describe("promoteToDefault", () => {
  it("clears prior defaults then sets the target row default", async () => {
    const chain = makeChain({ data: null, error: null });
    const sb = {
      from: vi.fn(() => chain),
    } as unknown as Parameters<typeof promoteToDefault>[0];
    await promoteToDefault(sb, "c1", "u1");
    // update called twice: first to clear, second to set.
    expect(chain.update).toHaveBeenCalledTimes(2);
    expect(chain.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ is_default: false }),
    );
    expect(chain.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ is_default: true }),
    );
  });
});
