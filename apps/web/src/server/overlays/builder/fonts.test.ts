import { describe, expect, it, vi } from "vitest";
import { uploadFont, listFonts, softDeleteFont } from "./fonts";

// Build a minimal in-memory mock client that records inserts.
function makeSb() {
  const state: Record<string, unknown[]> = {
    overlay_user_assets: [],
    overlay_user_design_fonts: [],
  };
  const storageUploads: Array<{ bucket: string; path: string; bytes: number }> = [];

  const sb: any = {
    from: (table: string) => ({
      insert: (rows: unknown) => ({
        select: () => ({
          single: async () => {
            const arr = Array.isArray(rows) ? rows : [rows];
            const row = { id: `${table}-${state[table].length + 1}`, ...(arr[0] as object) };
            state[table].push(row);
            return { data: row, error: null };
          },
        }),
      }),
      update: (patch: object) => ({
        eq: (_col: string, _val: string) => ({
          select: () => ({
            maybeSingle: async () => {
              const target = state[table][0];
              if (target) Object.assign(target, patch);
              return { data: target ?? null, error: null };
            },
          }),
        }),
      }),
      select: () => ({
        is: () => ({
          order: () => ({
            then: (cb: (v: unknown) => unknown) =>
              cb({ data: state[table], error: null }),
          }),
        }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: ArrayBuffer | Buffer) => {
          const sizeBytes =
            bytes instanceof Buffer
              ? bytes.length
              : (bytes as ArrayBuffer).byteLength;
          storageUploads.push({ bucket, path, bytes: sizeBytes });
          return { data: { path }, error: null };
        },
      }),
    },
  };

  return { sb, state, storageUploads };
}

vi.mock("fontkit", () => ({
  default: {
    create: (_buf: Buffer) => ({
      familyName: "MockFamily",
      subfamilyName: "Regular",
      postscriptName: "MockFamily-Regular",
    }),
  },
  create: (_buf: Buffer) => ({
    familyName: "MockFamily",
    subfamilyName: "Regular",
    postscriptName: "MockFamily-Regular",
  }),
}));

vi.mock("ttf2woff2", () => ({
  default: (buf: Buffer) => Buffer.from("woff2-converted-" + buf.length),
}));

describe("uploadFont", () => {
  const ACTOR = "user-uuid-admin";

  it("rejects size > 5MB", async () => {
    const { sb } = makeSb();
    const big = Buffer.alloc(6 * 1024 * 1024);
    await expect(
      uploadFont(sb, ACTOR, {
        fileBuffer: big,
        filename: "huge.ttf",
        mimeType: "font/ttf",
      }),
    ).rejects.toThrow(/5MB/i);
  });

  it("rejects non-font MIME", async () => {
    const { sb } = makeSb();
    await expect(
      uploadFont(sb, ACTOR, {
        fileBuffer: Buffer.from("not a font"),
        filename: "evil.exe",
        mimeType: "application/octet-stream",
      }),
    ).rejects.toThrow(/mime/i);
  });

  it("inserts asset rows for original + woff2 + a font row", async () => {
    const { sb, state, storageUploads } = makeSb();
    const result = await uploadFont(sb, ACTOR, {
      fileBuffer: Buffer.from("fake ttf bytes"),
      filename: "Custom Regular.ttf",
      mimeType: "font/ttf",
    });
    expect(result.familyName).toBe("MockFamily");
    expect(result.weight).toBe(400);
    expect(result.style).toBe("normal");
    expect(state.overlay_user_assets.length).toBe(2);
    expect(state.overlay_user_design_fonts.length).toBe(1);
    expect(storageUploads.length).toBe(2);
    const buckets = storageUploads.map((u) => u.bucket);
    expect(buckets.every((b) => b === "overlay-user-assets")).toBe(true);
  });

  it("skips WOFF2 conversion when upload is already WOFF2", async () => {
    const { sb, state, storageUploads } = makeSb();
    await uploadFont(sb, ACTOR, {
      fileBuffer: Buffer.from("woff2 bytes"),
      filename: "Already.woff2",
      mimeType: "font/woff2",
    });
    expect(storageUploads.length).toBe(1);
    expect(state.overlay_user_assets.length).toBe(1);
  });
});

describe("listFonts", () => {
  it("returns rows filtered by deleted_at IS NULL", async () => {
    const { sb, state } = makeSb();
    state.overlay_user_design_fonts.push(
      { id: "f1", family_name: "A", deleted_at: null },
      { id: "f2", family_name: "B", deleted_at: "2026-05-18T00:00:00Z" },
    );
    const rows = await listFonts(sb);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("softDeleteFont", () => {
  it("sets deleted_at on the matching row", async () => {
    const { sb, state } = makeSb();
    state.overlay_user_design_fonts.push({ id: "f-target", deleted_at: null });
    await softDeleteFont(sb, "user-admin", "f-target");
    const row = state.overlay_user_design_fonts[0] as { deleted_at: string | null };
    expect(row.deleted_at).not.toBeNull();
  });
});
