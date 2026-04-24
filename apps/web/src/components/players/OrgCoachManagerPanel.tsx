import Image from "next/image";
import { PlayerAvatar } from "./PlayerAvatar";

/**
 * Linkage audit slice (2026-04-24) — render a player's organization /
 * coach / team-manager affiliations on `/players/[id]`. Null-tolerant
 * on every sub-card:
 *
 *   - When `org`, `coach`, and `manager` are all null, the whole panel
 *     returns null (no empty section, no "no affiliations" copy).
 *   - When only one sub-piece exists, only that one card renders.
 *
 * Fully server-component-compatible — no client state, no effects.
 */

export type OrgCoachManagerProps = {
  org: { id: string; name: string; logoUrl: string | null } | null;
  coach: { id: string; displayName: string; photoUrl: string | null } | null;
  manager: { id: string; displayName: string; photoUrl: string | null } | null;
};

export function OrgCoachManagerPanel({
  org,
  coach,
  manager,
}: OrgCoachManagerProps) {
  if (!org && !coach && !manager) return null;

  return (
    <section
      data-testid="org-coach-manager-panel"
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
    >
      <header className="border-b border-[var(--ink-4)] bg-[var(--ink-1)] px-5 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--chalk-3)]">
          Affiliations
        </div>
        <h2 className="mt-1 font-display text-lg font-bold text-[var(--chalk-0)]">
          Organization &amp; staff
        </h2>
      </header>
      <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
        {org ? <OrgCard org={org} /> : null}
        {manager ? <StaffCard label="Team manager" person={manager} testId="org-panel-manager" /> : null}
        {coach ? <StaffCard label="Coach" person={coach} testId="org-panel-coach" /> : null}
      </div>
    </section>
  );
}

function OrgCard({ org }: { org: NonNullable<OrgCoachManagerProps["org"]> }) {
  return (
    <div
      data-testid="org-panel-org"
      className="flex items-center gap-4 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-4 py-3"
    >
      {org.logoUrl ? (
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]">
          <Image
            src={org.logoUrl}
            alt={`${org.name} logo`}
            fill
            sizes="48px"
            className="object-contain"
          />
        </div>
      ) : (
        <div
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] font-display text-sm font-bold text-[var(--chalk-2)]"
        >
          {org.name.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Organization
        </div>
        <div className="mt-1 truncate font-display text-sm font-semibold text-[var(--chalk-0)]">
          {org.name}
        </div>
      </div>
    </div>
  );
}

function StaffCard({
  label,
  person,
  testId,
}: {
  label: string;
  person: NonNullable<OrgCoachManagerProps["coach" | "manager"]>;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex items-center gap-4 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-4 py-3"
    >
      <PlayerAvatar
        photoUrl={person.photoUrl}
        displayName={person.displayName}
        size={48}
      />
      <div className="min-w-0">
        <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          {label}
        </div>
        <div className="mt-1 truncate font-display text-sm font-semibold text-[var(--chalk-0)]">
          {person.displayName}
        </div>
      </div>
    </div>
  );
}
