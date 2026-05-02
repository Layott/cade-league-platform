import { describe, it, expect, vi, beforeEach } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn((url: string) => {
  const e = new Error(`NEXT_REDIRECT;${url}`);
  (e as unknown as { digest: string }).digest = `NEXT_REDIRECT;replace;${url};303`;
  throw e;
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

// `revalidatePath` is invoked on the success path before the redirect; the
// vitest harness has no Next.js static-generation store, so we stub it so
// the redirect-throw assertion still surfaces (Bug 1, 2026-05-01).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const createMatchDayMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/matches/match-days", () => ({
  createMatchDay: createMatchDayMock,
}));

const seasonRow = { id: "11111111-1111-4111-8111-111111111111" };
const seasonsQuery = {
  select: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: seasonRow, error: null }),
};
const fakeSb = { from: vi.fn().mockReturnValue(seasonsQuery) };
vi.mock("@/lib/supabase/service", () => ({
  getServiceRoleSupabase: () => fakeSb,
}));

import { createMatchDayAction } from "./actions";

function buildForm(date = "2026-04-26"): FormData {
  const fd = new FormData();
  fd.set("matchDate", date);
  fd.set("arrivalCutoffTime", "09:00");
  fd.set("matchStartTime", "10:00");
  fd.set("venueName", "CADE Studio");
  return fd;
}

describe("createMatchDayAction — error paths (Plan 26b regression)", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    createMatchDayMock.mockReset();
    // Default season lookup returns a season; tests that need empty override.
    seasonsQuery.maybeSingle.mockResolvedValue({ data: seasonRow, error: null });
  });

  it("redirects with duplicate-date when unique constraint fires", async () => {
    createMatchDayMock.mockRejectedValue(
      new Error(
        'createMatchDay failed: duplicate key value violates unique constraint "match_days_season_id_match_date_key"'
      )
    );
    await expect(createMatchDayAction(buildForm("2026-04-26"))).rejects.toThrow(
      /NEXT_REDIRECT/
    );
    expect(redirectMock).toHaveBeenCalledWith(
      "/admin/match-days/new?error=duplicate-date&date=2026-04-26"
    );
  });

  it("redirects with create-failed for any other error", async () => {
    createMatchDayMock.mockRejectedValue(new Error("PG: column missing"));
    await expect(createMatchDayAction(buildForm())).rejects.toThrow(
      /NEXT_REDIRECT/
    );
    expect(redirectMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/admin/match-days/new?error=create-failed&detail="
      )
    );
  });

  it("redirects with no-active-season when seasons lookup is empty", async () => {
    seasonsQuery.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    await expect(createMatchDayAction(buildForm())).rejects.toThrow(
      /NEXT_REDIRECT/
    );
    expect(redirectMock).toHaveBeenCalledWith(
      "/admin/match-days/new?error=no-active-season"
    );
  });

  it("redirects to detail page on success", async () => {
    createMatchDayMock.mockResolvedValue({ id: "abc-123" });
    await expect(createMatchDayAction(buildForm())).rejects.toThrow(
      /NEXT_REDIRECT/
    );
    expect(redirectMock).toHaveBeenCalledWith("/admin/match-days/abc-123");
  });
});
