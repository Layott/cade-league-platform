import { describe, it, expect } from "vitest";
import {
  ADMIN_HUBS,
  findHubByPath,
  findSubtabByPath,
  visibleHubs,
  visibleSubtabs,
} from "./admin-nav";

describe("admin-nav", () => {
  describe("ADMIN_HUBS", () => {
    it("has exactly 8 hubs", () => {
      expect(ADMIN_HUBS).toHaveLength(8);
    });

    it("every hub has unique key + href", () => {
      const keys = new Set<string>();
      const hrefs = new Set<string>();
      for (const hub of ADMIN_HUBS) {
        expect(keys.has(hub.key)).toBe(false);
        expect(hrefs.has(hub.href)).toBe(false);
        keys.add(hub.key);
        hrefs.add(hub.href);
      }
    });

    it("every hub has a description + perm", () => {
      for (const hub of ADMIN_HUBS) {
        expect(hub.description.length).toBeGreaterThan(0);
        expect(hub.perm.length).toBeGreaterThan(0);
      }
    });
  });

  describe("findHubByPath", () => {
    it("matches the canonical hub URL", () => {
      const hub = findHubByPath("/admin/match-days");
      expect(hub?.key).toBe("match-days");
    });

    it("matches a deep sub-route", () => {
      const hub = findHubByPath("/admin/people/players/abc-123/edit");
      expect(hub?.key).toBe("roster");
    });

    it("prefers /admin/broadcast/v2 over a hypothetical /admin/broadcast hub", () => {
      // Slice 4 reality — only /admin/broadcast/v2 exists as a hub. The legacy
      // /admin/broadcast 307s into /admin/broadcast/v2; verify it does NOT
      // match a non-existent shorter hub.
      const hub = findHubByPath("/admin/broadcast/v2");
      expect(hub?.key).toBe("broadcast");
    });

    it("returns null for non-admin paths", () => {
      expect(findHubByPath("/profile")).toBeNull();
      expect(findHubByPath("/")).toBeNull();
    });

    it("returns null for /admin (the dashboard root, not a hub)", () => {
      // /admin renders the tile grid; it is not a hub itself.
      expect(findHubByPath("/admin")).toBeNull();
    });
  });

  describe("findSubtabByPath", () => {
    it("matches the calendar subtab on bare /admin/match-days", () => {
      const hub = findHubByPath("/admin/match-days");
      expect(hub).not.toBeNull();
      const tab = findSubtabByPath(hub!, "/admin/match-days");
      expect(tab?.key).toBe("calendar");
    });

    it("matches the stats-review subtab", () => {
      const hub = findHubByPath("/admin/match-days/stats-review");
      const tab = findSubtabByPath(hub!, "/admin/match-days/stats-review");
      expect(tab?.key).toBe("stats-review");
    });

    it("matches /admin/people/players/[id] to the players subtab", () => {
      const hub = findHubByPath("/admin/people/players/foo");
      const tab = findSubtabByPath(hub!, "/admin/people/players/foo");
      expect(tab?.key).toBe("players");
    });

    it("matches /admin/people/security/sessions to the sessions subtab", () => {
      const hub = findHubByPath("/admin/people/security/sessions");
      const tab = findSubtabByPath(hub!, "/admin/people/security/sessions");
      expect(tab?.key).toBe("sessions");
    });
  });

  describe("visibleHubs", () => {
    it("admin wildcard sees every hub", () => {
      const visible = visibleHubs(["*"]);
      expect(visible).toHaveLength(8);
    });

    it("loc sees match-days + tournament + squads but not roster/discipline", () => {
      // loc seed perms: squads.validate, squads.change_authorize,
      // squads.window.manage, squads.player_override.manage,
      // tournament.read, tournament.export
      const locPerms = [
        "squads.validate",
        "squads.change_authorize",
        "squads.window.manage",
        "squads.player_override.manage",
        "tournament.read",
        "tournament.export",
      ];
      const visible = visibleHubs(locPerms).map((h) => h.key);
      expect(visible).toContain("tournament");
      expect(visible).toContain("squads");
      expect(visible).not.toContain("roster"); // users.edit denied
      expect(visible).not.toContain("system"); // trash.restore denied
    });

    it("idc gets read-only tournament + nothing else", () => {
      const idcPerms = ["tournament.read", "tournament.export"];
      const visible = visibleHubs(idcPerms).map((h) => h.key);
      expect(visible).toContain("tournament");
      expect(visible).not.toContain("match-days");
      expect(visible).not.toContain("discipline");
      expect(visible).not.toContain("squads");
    });

    it("referee sees squads only (per current perm seed)", () => {
      const refPerms = [
        "squads.validate",
        "squads.change_authorize",
        "squads.window.manage",
        "squads.player_override.manage",
        "attendance.mark",
        "attendance.edit",
        "tournament.walkover_confirm",
      ];
      const visible = visibleHubs(refPerms).map((h) => h.key);
      // Referee seed has squads.* but only tournament.walkover_confirm (not
      // tournament.read), so the Tournament hub is NOT visible. Refs don't
      // need to browse the tournament console — they only confirm walkovers
      // via per-action gates inside other surfaces.
      expect(visible).toContain("squads");
      expect(visible).not.toContain("tournament");
      expect(visible).not.toContain("discipline");
      expect(visible).not.toContain("roster");
    });

    it("moderator sees discipline + comms + match-days", () => {
      const modPerms = [
        "announcements.*",
        "punishments.issue",
        "punishments.edit",
        "punishments.read",
        "attendance.mark",
        "attendance.edit",
        "matches.read",
        "standings.read",
        "audit.read",
        "orgs.read",
        "disputes.read",
        "disputes.rule",
        "appeals.read",
        "appeals.rule",
        "stats.screenshot.upload",
        "stats.screenshot.review",
      ];
      const visible = visibleHubs(modPerms).map((h) => h.key);
      expect(visible).toContain("discipline"); // punishments.read
      expect(visible).toContain("comms"); // announcements.*
      expect(visible).toContain("match-days"); // matches.read
    });

    it("no-role user (viewer) sees nothing in the admin shell", () => {
      const visible = visibleHubs([]);
      expect(visible).toHaveLength(0);
    });
  });

  describe("visibleSubtabs", () => {
    it("returns every subtab for admin wildcard", () => {
      const tournament = ADMIN_HUBS.find((h) => h.key === "tournament")!;
      const visible = visibleSubtabs(tournament, ["*"]);
      expect(visible.length).toBe(tournament.subtabs!.length);
    });

    it("filters subtabs by perm", () => {
      const discipline = ADMIN_HUBS.find((h) => h.key === "discipline")!;
      // viewer has no discipline perms
      const visible = visibleSubtabs(discipline, ["punishments.read"]);
      // punishments.read covers punishments + precedents subtabs
      const keys = visible.map((t) => t.key);
      expect(keys).toContain("punishments");
      expect(keys).toContain("precedents"); // also keyed on punishments.read
      expect(keys).not.toContain("disputes");
      expect(keys).not.toContain("appeals");
    });
  });
});
