"use client";

import { useMemo, useState, useTransition } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { saveMatrixAction } from "./actions";
import type { RoleName } from "@/perms";

type Props = {
  roles: readonly RoleName[];
  permissions: readonly string[];
  // Map<role, Set<permission>> — which cells are currently granted.
  initialMatrix: Record<string, string[]>;
};

/**
 * MatrixEditor — client component wrapping the roles × permissions grid.
 *
 * Renders:
 *  - header row: permission labels (monospaced — they're identifiers)
 *  - one row per role, each cell a checkbox
 *  - admin × '*' cell is disabled (spec §8 Risk 7 — wildcard is locked)
 *
 * State: a local map of the live matrix. On Save, we diff against the
 * initial state and POST only the changed cells through the server action.
 * On success the page revalidates + the initial snapshot is re-read from
 * the server (that's where the green "Saved" flash goes).
 */
export function MatrixEditor({ roles, permissions, initialMatrix }: Props) {
  const initialSets = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of roles) m.set(r, new Set(initialMatrix[r] ?? []));
    return m;
  }, [roles, initialMatrix]);

  const [current, setCurrent] = useState<Map<string, Set<string>>>(() => {
    const m = new Map<string, Set<string>>();
    for (const [k, v] of initialSets) m.set(k, new Set(v));
    return m;
  });

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  function toggle(role: string, permission: string, checked: boolean) {
    if (role === "admin" && permission === "*") return; // locked
    setCurrent((prev) => {
      const next = new Map(prev);
      const s = new Set(next.get(role) ?? []);
      if (checked) s.add(permission);
      else s.delete(permission);
      next.set(role, s);
      return next;
    });
    setSavedFlash(false);
  }

  function buildDiff(): { role: string; permission: string; grant: boolean }[] {
    const diff: { role: string; permission: string; grant: boolean }[] = [];
    for (const r of roles) {
      const init = initialSets.get(r) ?? new Set();
      const now = current.get(r) ?? new Set();
      for (const p of permissions) {
        const before = init.has(p);
        const after = now.has(p);
        if (before !== after) {
          diff.push({ role: r, permission: p, grant: after });
        }
      }
    }
    return diff;
  }

  function reset() {
    const m = new Map<string, Set<string>>();
    for (const [k, v] of initialSets) m.set(k, new Set(v));
    setCurrent(m);
    setError(null);
    setSavedFlash(false);
  }

  function save() {
    const diff = buildDiff();
    if (diff.length === 0) {
      setError("Nothing changed.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("diff", JSON.stringify({ diff }));
    startTransition(async () => {
      try {
        await saveMatrixAction(fd);
        setSavedFlash(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  const diffCount = buildDiff().length;

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]">
        <table
          className="min-w-full border-separate border-spacing-0 text-sm text-[var(--chalk-1)]"
          data-testid="role-matrix"
        >
          <thead>
            <tr className="bg-[var(--ink-3)]/60">
              <th
                scope="col"
                className="sticky left-0 z-10 border-b border-[var(--ink-4)] bg-[var(--ink-3)] px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]"
              >
                Role
              </th>
              {permissions.map((p) => (
                <th
                  key={p}
                  scope="col"
                  className="border-b border-[var(--ink-4)] px-3 py-2.5 text-left font-mono text-[11px] font-semibold text-[var(--chalk-2)]"
                >
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map((role, idx) => (
              <tr
                key={role}
                className={
                  "border-b border-[var(--ink-4)]/70 " +
                  (idx % 2 === 1 ? "bg-[var(--ink-3)]/30" : "")
                }
                data-testid={`role-row-${role}`}
              >
                <th
                  scope="row"
                  className={
                    "sticky left-0 z-[5] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.18em] " +
                    (idx % 2 === 1
                      ? "bg-[var(--ink-2)]"
                      : "bg-[var(--ink-2)]/95")
                  }
                >
                  {role.replace(/_/g, " ")}
                </th>
                {permissions.map((p) => {
                  const locked = role === "admin" && p === "*";
                  const checked = current.get(role)?.has(p) ?? false;
                  return (
                    <td
                      key={`${role}:${p}`}
                      className="px-3 py-2.5 text-left"
                    >
                      <input
                        type="checkbox"
                        name={`matrix-${role}-${p}`}
                        aria-label={`${role} has ${p}`}
                        checked={checked}
                        disabled={locked}
                        title={
                          locked
                            ? "admin wildcard is locked — uncheck specific permissions on other roles instead"
                            : undefined
                        }
                        onChange={(e) => toggle(role, p, e.target.checked)}
                        className={
                          "h-4 w-4 cursor-pointer rounded border border-[var(--ink-4)] bg-[var(--ink-1)] accent-[var(--signal)] " +
                          (locked ? "cursor-not-allowed opacity-60" : "")
                        }
                        data-testid={`cell-${role}-${p}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="flex flex-wrap items-center gap-3"
        data-testid="matrix-toolbar"
      >
        <PrimaryButton
          type="button"
          onClick={save}
          disabled={pending || diffCount === 0}
        >
          {pending ? "Saving..." : `Save changes${diffCount ? ` (${diffCount})` : ""}`}
        </PrimaryButton>
        <SecondaryButton type="button" onClick={reset} disabled={pending}>
          Reset
        </SecondaryButton>
        {savedFlash ? (
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--signal)]">
            Saved
          </span>
        ) : null}
        {error ? (
          <span
            className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--flare)]"
            data-testid="matrix-error"
          >
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
