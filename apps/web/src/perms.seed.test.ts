import { describe, it, expect } from "vitest";
import { hasPerm, PERMS, PUBLIC_PERMS, ROLE_NAMES, type RoleName } from "./perms";

describe("hasPerm (seed fallback)", () => {
  it("admin matches a wildcard scope", () => {
    expect(hasPerm({ userId: null, roles: ["admin"] }, "matches.enter_score")).toBe(true);
  });

  it("moderator can publish announcements but not edit users", () => {
    expect(hasPerm({ userId: null, roles: ["moderator"] }, "announcements.publish")).toBe(true);
    expect(hasPerm({ userId: null, roles: ["moderator"] }, "users.delete")).toBe(false);
  });

  it("player cannot mark attendance", () => {
    expect(hasPerm({ userId: null, roles: ["player"] }, "attendance.mark")).toBe(false);
  });

  it("unauthenticated (no roles) can read public standings", () => {
    expect(hasPerm({ userId: null, roles: [] }, "standings.read.public")).toBe(true);
  });

  it("multi-role user gets union of permissions", () => {
    expect(hasPerm({ userId: null, roles: ["player", "moderator"] }, "punishments.issue")).toBe(true);
  });

  it("admin has attendance.mark and attendance.edit", () => {
    expect(hasPerm({ userId: "u", roles: ["admin"] }, "attendance.mark")).toBe(true);
    expect(hasPerm({ userId: "u", roles: ["admin"] }, "attendance.edit")).toBe(true);
  });

  it("moderator has attendance.mark and attendance.edit", () => {
    expect(hasPerm({ userId: "u", roles: ["moderator"] }, "attendance.mark")).toBe(true);
    expect(hasPerm({ userId: "u", roles: ["moderator"] }, "attendance.edit")).toBe(true);
  });

  it("player does NOT have attendance.mark", () => {
    expect(hasPerm({ userId: "u", roles: ["player"] }, "attendance.mark")).toBe(false);
  });

  it("viewer does NOT have attendance.edit", () => {
    expect(hasPerm({ userId: null, roles: [] }, "attendance.edit")).toBe(false);
  });
});

describe("seed contract (Phase 1B 12-role matrix)", () => {
  it("ROLE_NAMES contains all 12 Phase 1B roles", () => {
    const expected: RoleName[] = [
      "admin",
      "loc",
      "idc",
      "referee",
      "technical",
      "production",
      "design",
      "moderator",
      "coach",
      "team_manager",
      "player",
      "viewer",
    ];
    expect(ROLE_NAMES.length).toBe(12);
    for (const r of expected) expect(ROLE_NAMES).toContain(r);
  });

  it("PERMS keys cover every role in ROLE_NAMES", () => {
    for (const r of ROLE_NAMES) {
      expect(Object.prototype.hasOwnProperty.call(PERMS, r)).toBe(true);
    }
  });

  it("PUBLIC_PERMS is unchanged from Phase 1A", () => {
    expect(PUBLIC_PERMS).toEqual([
      "matches.read.public",
      "standings.read.public",
      "announcements.read.public",
      "players.read.public",
      "fixtures.read.public",
      "punishments.read.public",
    ]);
  });

  it("coach + team_manager + viewer still seed to empty", () => {
    // Plan 51 promoted idc/technical/design out of the empty set; they
    // each now hold a small slice of tournament/broadcast.v2 perms.
    const empties: RoleName[] = ["coach", "team_manager", "viewer"];
    for (const r of empties) {
      expect(PERMS[r].length).toBe(0);
    }
  });

  it("loc + referee seed with squads.* perms (Plan 10)", () => {
    expect(PERMS.loc).toContain("squads.validate");
    expect(PERMS.loc).toContain("squads.change_authorize");
    expect(PERMS.referee).toContain("squads.validate");
    expect(PERMS.referee).toContain("squads.change_authorize");
  });

  it("referee holds attendance.mark + attendance.edit (Plan 46)", () => {
    expect(PERMS.referee).toContain("attendance.mark");
    expect(PERMS.referee).toContain("attendance.edit");
    expect(
      hasPerm({ userId: null, roles: ["referee"] }, "attendance.mark"),
    ).toBe(true);
    expect(
      hasPerm({ userId: null, roles: ["referee"] }, "attendance.edit"),
    ).toBe(true);
  });

  it("player seed holds squads.submit.own (Plan 10)", () => {
    expect(PERMS.player).toContain("squads.submit.own");
  });

  it("production seed holds broadcast.trigger + match_clock.manage + broadcast.match_control (Plan 12 + 37 + 42) plus broadcast.v2 (Plan 51)", () => {
    expect(PERMS.production).toEqual([
      "broadcast.trigger",
      "match_clock.manage",
      "broadcast.match_control",
      "broadcast.v2.read",
      "broadcast.v2.trigger",
    ]);
  });

  it("admin matches broadcast.trigger and broadcast.manage via wildcard", () => {
    expect(hasPerm({ userId: null, roles: ["admin"] }, "broadcast.trigger")).toBe(true);
    expect(hasPerm({ userId: null, roles: ["admin"] }, "broadcast.manage")).toBe(true);
  });

  it("production can trigger overlays but cannot manage sessions", () => {
    expect(hasPerm({ userId: null, roles: ["production"] }, "broadcast.trigger")).toBe(true);
    expect(hasPerm({ userId: null, roles: ["production"] }, "broadcast.manage")).toBe(false);
  });

  it("moderator and player have neither broadcast perm", () => {
    expect(hasPerm({ userId: null, roles: ["moderator"] }, "broadcast.trigger")).toBe(false);
    expect(hasPerm({ userId: null, roles: ["player"] }, "broadcast.manage")).toBe(false);
  });

  it("admin seed is wildcard + explicit squads.reopen + broadcast.match_control + branding.manage (Plans 41, 42, 47)", () => {
    // Admin still wins everything via '*'; we seed explicit entries so the
    // role_permissions table stays self-documenting for future role editors.
    // See supabase/migrations/20260509000001_plan41_squads_reopen_perm_seed.sql
    // and supabase/migrations/20260509000101_plan42_broadcast_perms_seed.sql.
    // Plan 47 adds branding.manage to the explicit seed.
    expect(PERMS.admin).toContain("*");
    expect(PERMS.admin).toContain("squads.reopen");
    expect(PERMS.admin).toContain("broadcast.match_control");
    expect(PERMS.admin).toContain("branding.manage");
  });

  it("admin matches branding.manage via wildcard (Plan 47)", () => {
    expect(hasPerm({ userId: null, roles: ["admin"] }, "branding.manage")).toBe(
      true,
    );
  });

  it("non-admin roles do not have branding.manage (Plan 47)", () => {
    for (const r of ROLE_NAMES) {
      if (r === "admin") continue;
      expect(PERMS[r]).not.toContain("branding.manage");
    }
  });

  it("admin + production hold broadcast.match_control; others do not (Plan 42)", () => {
    expect(hasPerm({ userId: null, roles: ["admin"] }, "broadcast.match_control")).toBe(true);
    expect(hasPerm({ userId: null, roles: ["production"] }, "broadcast.match_control")).toBe(true);
    expect(hasPerm({ userId: null, roles: ["moderator"] }, "broadcast.match_control")).toBe(false);
    expect(hasPerm({ userId: null, roles: ["player"] }, "broadcast.match_control")).toBe(false);
    expect(hasPerm({ userId: null, roles: ["viewer"] }, "broadcast.match_control")).toBe(false);
  });

  it("moderator has stats.screenshot.upload + review (Plan 14)", () => {
    expect(PERMS.moderator).toContain("stats.screenshot.upload");
    expect(PERMS.moderator).toContain("stats.screenshot.review");
  });

  it("admin matches stats.* via wildcard (Plan 14)", () => {
    expect(hasPerm({ userId: null, roles: ["admin"] }, "stats.screenshot.upload")).toBe(true);
    expect(hasPerm({ userId: null, roles: ["admin"] }, "stats.screenshot.delete")).toBe(true);
    expect(hasPerm({ userId: null, roles: ["admin"] }, "stats.ocr.rerun")).toBe(true);
  });

  it("player is denied every stats.* perm (Plan 14)", () => {
    expect(hasPerm({ userId: null, roles: ["player"] }, "stats.screenshot.upload")).toBe(false);
    expect(hasPerm({ userId: null, roles: ["player"] }, "stats.screenshot.review")).toBe(false);
    expect(hasPerm({ userId: null, roles: ["player"] }, "stats.screenshot.delete")).toBe(false);
    expect(hasPerm({ userId: null, roles: ["player"] }, "stats.ocr.rerun")).toBe(false);
  });

  it("moderator cannot delete or re-run OCR (admin-only)", () => {
    expect(hasPerm({ userId: null, roles: ["moderator"] }, "stats.screenshot.delete")).toBe(false);
    expect(hasPerm({ userId: null, roles: ["moderator"] }, "stats.ocr.rerun")).toBe(false);
  });

  // Plan 13A — governance perms (orgs/disputes/appeals).
  // Plan 33 (2026-04-22) dropped content obligations + preseason shoots;
  // `content.*` and `preseason.manage` are no longer seeded on any role.
  it("moderator can read orgs and review disputes/appeals", () => {
    const roles = ["moderator"] as const;
    expect(hasPerm({ userId: null, roles }, "orgs.read")).toBe(true);
    expect(hasPerm({ userId: null, roles }, "disputes.read")).toBe(true);
    expect(hasPerm({ userId: null, roles }, "disputes.rule")).toBe(true);
    expect(hasPerm({ userId: null, roles }, "appeals.read")).toBe(true);
    expect(hasPerm({ userId: null, roles }, "appeals.rule")).toBe(true);
  });

  it("moderator cannot edit orgs or write to ledger (admin-only)", () => {
    const roles = ["moderator"] as const;
    expect(hasPerm({ userId: null, roles }, "orgs.edit")).toBe(false);
    expect(hasPerm({ userId: null, roles }, "orgs.ledger.write")).toBe(false);
  });

  it("player can submit + read own disputes/appeals", () => {
    const roles = ["player"] as const;
    expect(hasPerm({ userId: null, roles }, "disputes.submit")).toBe(true);
    expect(hasPerm({ userId: null, roles }, "disputes.read.own")).toBe(true);
    expect(hasPerm({ userId: null, roles }, "appeals.submit")).toBe(true);
    expect(hasPerm({ userId: null, roles }, "appeals.read.own")).toBe(true);
  });

  it("player cannot rule — only admin + moderator can", () => {
    const roles = ["player"] as const;
    expect(hasPerm({ userId: null, roles }, "disputes.rule")).toBe(false);
    expect(hasPerm({ userId: null, roles }, "appeals.rule")).toBe(false);
    expect(hasPerm({ userId: null, roles }, "orgs.edit")).toBe(false);
  });

  it("admin via wildcard matches every retained Plan 13A perm", () => {
    const roles = ["admin"] as const;
    for (const p of [
      "orgs.read",
      "orgs.edit",
      "orgs.ledger.read",
      "orgs.ledger.write",
      "disputes.rule",
      "appeals.rule",
    ]) {
      expect(hasPerm({ userId: null, roles }, p)).toBe(true);
    }
  });

  // Plan 51 — Tournament + Broadcast v2 perm seeds.
  it("admin seeds every Plan 51 perm explicitly (self-documenting beyond '*')", () => {
    const tournament = [
      "tournament.read",
      "tournament.score_entry",
      "tournament.walkover_confirm",
      "tournament.tiebreaker_config",
      "tournament.export",
    ];
    const broadcastV2 = ["broadcast.v2.read", "broadcast.v2.trigger"];
    for (const p of [...tournament, ...broadcastV2]) {
      expect(PERMS.admin).toContain(p);
    }
  });

  it("loc + idc seed only tournament.read + tournament.export from Plan 51", () => {
    for (const r of ["loc", "idc"] as const) {
      expect(PERMS[r]).toContain("tournament.read");
      expect(PERMS[r]).toContain("tournament.export");
      expect(PERMS[r]).not.toContain("tournament.score_entry");
      expect(PERMS[r]).not.toContain("tournament.walkover_confirm");
      expect(PERMS[r]).not.toContain("tournament.tiebreaker_config");
      expect(PERMS[r]).not.toContain("broadcast.v2.read");
      expect(PERMS[r]).not.toContain("broadcast.v2.trigger");
    }
  });

  it("technical seeds tournament.read + broadcast.v2.{read,trigger} from Plan 51", () => {
    expect(PERMS.technical).toContain("tournament.read");
    expect(PERMS.technical).toContain("broadcast.v2.read");
    expect(PERMS.technical).toContain("broadcast.v2.trigger");
    expect(PERMS.technical).not.toContain("tournament.score_entry");
    expect(PERMS.technical).not.toContain("tournament.export");
  });

  it("design seeds broadcast.v2.read only from Plan 51 (no trigger, no tournament)", () => {
    expect(PERMS.design).toContain("broadcast.v2.read");
    expect(PERMS.design).not.toContain("broadcast.v2.trigger");
    expect(PERMS.design).not.toContain("tournament.read");
  });

  it("referee gains tournament.walkover_confirm from Plan 51", () => {
    expect(PERMS.referee).toContain("tournament.walkover_confirm");
    expect(
      hasPerm({ userId: null, roles: ["referee"] }, "tournament.walkover_confirm"),
    ).toBe(true);
  });

  it("admin matches every Plan 51 perm via wildcard", () => {
    for (const p of [
      "tournament.read",
      "tournament.score_entry",
      "tournament.walkover_confirm",
      "tournament.tiebreaker_config",
      "tournament.export",
      "broadcast.v2.read",
      "broadcast.v2.trigger",
    ]) {
      expect(hasPerm({ userId: null, roles: ["admin"] }, p)).toBe(true);
    }
  });

  it("player + viewer hold no Plan 51 perms", () => {
    for (const r of ["player", "viewer"] as const) {
      for (const p of [
        "tournament.read",
        "tournament.score_entry",
        "tournament.walkover_confirm",
        "tournament.tiebreaker_config",
        "tournament.export",
        "broadcast.v2.read",
        "broadcast.v2.trigger",
      ]) {
        expect(hasPerm({ userId: null, roles: [r] }, p)).toBe(false);
      }
    }
  });

  it("Plan 33: content + preseason perms are no longer seeded on any role", () => {
    const dropped = [
      "content.submit",
      "content.verify",
      "content.read.own",
      "preseason.manage",
    ];
    for (const r of ROLE_NAMES) {
      if (r === "admin") continue; // wildcard matches everything by design.
      for (const p of dropped) {
        expect(PERMS[r]).not.toContain(p);
      }
    }
  });

  // Bug 11 (2026-05-01) — `users.unlock` is held by admin (via '*'),
  // loc, and idc; nobody else can clear another player's lockout.
  it("Bug 11: users.unlock seeds for admin/loc/idc only", () => {
    expect(PERMS.loc).toContain("users.unlock");
    expect(PERMS.idc).toContain("users.unlock");
    expect(hasPerm({ userId: null, roles: ["admin"] }, "users.unlock")).toBe(true);
    expect(hasPerm({ userId: null, roles: ["loc"] }, "users.unlock")).toBe(true);
    expect(hasPerm({ userId: null, roles: ["idc"] }, "users.unlock")).toBe(true);
    for (const r of [
      "referee",
      "technical",
      "production",
      "design",
      "moderator",
      "coach",
      "team_manager",
      "player",
      "viewer",
    ] as const) {
      expect(PERMS[r]).not.toContain("users.unlock");
      expect(hasPerm({ userId: null, roles: [r] }, "users.unlock")).toBe(false);
    }
  });
});
