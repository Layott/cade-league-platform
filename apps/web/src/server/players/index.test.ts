import { describe, it, expect, vi } from "vitest";
import { listPlayersInActiveSeason, getPlayerById } from "./index";

const seasonRow = {
  id: "season-1",
  year_range: "2025-2026",
  division_name: "Division 1 Elite",
  status: "active",
  start_date: "2025-09-01",
  end_date: "2026-06-30",
};

const joinRows = [
  {
    entry_status: "confirmed",
    players: {
      id: "p1",
      user_id: "u1",
      gamer_tag: "ACE_Spek",
      psn_id: "spek_01",
      jersey_number: 10,
      photo_url: null,
      bio: null,
      users: { id: "u1", display_name: "Spektakula" },
    },
  },
  {
    entry_status: "confirmed",
    players: {
      id: "p2",
      user_id: "u2",
      gamer_tag: "KINGZ_kb",
      psn_id: "kb_keeper",
      jersey_number: 1,
      photo_url: "https://example.com/kb.jpg",
      bio: "Keeper",
      users: { id: "u2", display_name: "KB" },
    },
  },
];

function mockSb({
  season,
  participants,
  single,
}: {
  season?: typeof seasonRow | null;
  participants?: typeof joinRows;
  single?: (typeof joinRows)[number]["players"] & {
    users: { id: string; display_name: string };
  };
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "seasons") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: season ?? null, error: null }),
              })),
            })),
          })),
        };
      }
      if (table === "season_participants") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  order: vi.fn().mockResolvedValue({ data: participants ?? [], error: null }),
                })),
              })),
            })),
          })),
        };
      }
      if (table === "players") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: single ?? null, error: null }),
              })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

describe("players module", () => {
  it("listPlayersInActiveSeason returns flattened PlayerView rows", async () => {
    const sb = mockSb({ season: seasonRow, participants: joinRows });
    const result = await listPlayersInActiveSeason(sb as never);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "p2",
      user_id: "u2",
      display_name: "KB",
      gamer_tag: "KINGZ_kb",
      jersey_number: 1,
      entry_status: "confirmed",
    });
    expect(result[1].display_name).toBe("Spektakula");
  });

  it("listPlayersInActiveSeason returns [] when no active season", async () => {
    const sb = mockSb({ season: null });
    const result = await listPlayersInActiveSeason(sb as never);
    expect(result).toEqual([]);
  });

  it("getPlayerById returns a single PlayerView", async () => {
    const sb = mockSb({
      single: {
        id: "p1",
        user_id: "u1",
        gamer_tag: "ACE_Spek",
        psn_id: "spek_01",
        jersey_number: 10,
        photo_url: null,
        bio: "Forward",
        users: { id: "u1", display_name: "Spektakula" },
      },
    });
    const result = await getPlayerById(sb as never, "p1");
    expect(result).toMatchObject({
      id: "p1",
      display_name: "Spektakula",
      gamer_tag: "ACE_Spek",
      bio: "Forward",
    });
  });

  it("getPlayerById returns null when not found", async () => {
    const sb = mockSb({ single: undefined });
    const result = await getPlayerById(sb as never, "missing");
    expect(result).toBeNull();
  });
});
