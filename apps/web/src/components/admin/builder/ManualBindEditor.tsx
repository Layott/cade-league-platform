"use client";

import { useMemo, useState } from "react";
import type { Binding, FeedName } from "@/server/overlays/builder/types";
import { validateBinding } from "@/server/overlays/builder/binding-validator";

const FEEDS: FeedName[] = [
  "standings",
  "live_score",
  "top_scorers",
  "h2h",
  "match",
  "match_day",
  "custom_text",
];

const MOCK: Record<FeedName, unknown> = {
  standings: [
    { name: "ADEFOLA", points: 24, gd: 12 },
    { name: "ANIFE", points: 22, gd: 9 },
    { name: "BAJI JNR", points: 21, gd: 6 },
  ],
  live_score: {
    home_name: "ADEFOLA",
    away_name: "ANIFE",
    home_score: 2,
    away_score: 1,
    clock: "12:34",
  },
  top_scorers: [
    { name: "ADEFOLA", goals: 14, photoUrl: "/x.png" },
  ],
  h2h: {
    playerA: { name: "ADEFOLA", winProbPct: 58 },
    playerB: { name: "ANIFE", winProbPct: 42 },
  },
  match: { home_name: "ADEFOLA", away_name: "ANIFE" },
  match_day: [{ home_name: "ADEFOLA", away_name: "ANIFE", kickoff: "20:00" }],
  custom_text: { caster_1_name: "Sample" },
};

function resolvePath(feed: FeedName, path: string): unknown {
  const root = MOCK[feed];
  if (!path) return root;
  // Split into segments via a simple state machine — same allowlist as
  // binding-validator.ts. Anything weird becomes "" since the validator
  // rejected it upstream of here in real use.
  const re = /[A-Za-z_][A-Za-z0-9_]*|\[\d+\]/g;
  const tokens = path.match(re) ?? [];
  let cur: unknown = root;
  for (const t of tokens) {
    if (cur == null) return undefined;
    if (t.startsWith("[")) {
      const i = Number(t.slice(1, -1));
      cur = (cur as unknown[])[i];
    } else {
      cur = (cur as Record<string, unknown>)[t];
    }
  }
  return cur;
}

function applyTemplate(feed: FeedName, tpl: string): string {
  return tpl.replace(/\$\{([^}]+)\}/g, (_m, expr) => {
    // strip optional leading feed-name prefix: `standings[0].name` → `[0].name`
    let p = expr as string;
    if (p.startsWith(feed)) p = p.slice(feed.length);
    if (p.startsWith(".")) p = p.slice(1);
    const v = resolvePath(feed, p);
    return v == null ? "" : String(v);
  });
}

export function ManualBindEditor({
  value,
  onChange,
  onClear,
}: {
  value: Binding | null;
  onChange: (next: Binding) => void;
  onClear: () => void;
}) {
  const feed = value?.feed ?? "standings";
  const fieldPath = value?.fieldPath ?? "";
  const templateString = value?.templateString ?? "";

  // Local draft of the templateString so we can validate on every keystroke
  // before committing via onChange.
  const [tplDraft, setTplDraft] = useState<string | null>(null);
  // The "live" template value for validation purposes.
  const liveTemplate = tplDraft !== null ? tplDraft : templateString;

  const validation = useMemo(() => {
    // Build a candidate binding using the live (possibly uncommitted) templateString.
    const candidate: Binding = {
      feed,
      fieldPath: fieldPath || "placeholder",
      ...(liveTemplate ? { templateString: liveTemplate } : {}),
    };
    const r = validateBinding(candidate, FEEDS);
    return r.ok ? { ok: true as const, errors: [] as string[] } : { ok: false as const, errors: r.errors };
  }, [feed, fieldPath, liveTemplate]);

  const preview = useMemo(() => {
    if (!value && !liveTemplate) return "";
    const activeFeed = value?.feed ?? feed;
    if (liveTemplate) return applyTemplate(activeFeed, liveTemplate);
    if (value?.templateString) return applyTemplate(activeFeed, value.templateString);
    const v = resolvePath(activeFeed, value?.fieldPath ?? fieldPath);
    return v == null ? "" : String(v);
  }, [value, feed, fieldPath, liveTemplate]);

  function update(patch: Partial<Binding>) {
    const next: Binding = {
      feed,
      fieldPath,
      ...(templateString ? { templateString } : {}),
      ...patch,
    };
    onChange(next);
  }

  function handleTemplateChange(raw: string) {
    setTplDraft(raw);
    // Only propagate to parent when valid.
    const candidate: Binding = {
      feed,
      fieldPath: fieldPath || "placeholder",
      ...(raw ? { templateString: raw } : {}),
    };
    const r = validateBinding(candidate, FEEDS);
    if (r.ok) {
      update({ templateString: raw || undefined });
    }
    // If invalid: keep draft visible for error display but don't call onChange.
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">Feed</span>
        <select
          aria-label="Feed"
          value={feed}
          onChange={(e) => update({ feed: e.target.value as FeedName })}
          className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
        >
          {FEEDS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">
          Field path
        </span>
        <input
          type="text"
          aria-label="Field path"
          placeholder="[0].name"
          value={fieldPath}
          onChange={(e) => update({ fieldPath: e.target.value })}
          className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">
          Template string (optional)
        </span>
        <textarea
          aria-label="Template string"
          rows={2}
          placeholder="${standings[0].name} (${standings[0].points} pts)"
          value={liveTemplate}
          onChange={(e) => handleTemplateChange(e.target.value)}
          className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
        />
      </label>

      {!validation.ok && (
        <p role="alert" className="text-sm text-rose-400">
          {validation.errors.join("; ")}
        </p>
      )}

      <div
        data-testid="manual-bind-preview"
        className="rounded border border-white/10 bg-zinc-950 p-2 text-xs text-white/80"
      >
        Preview: <span className="text-white">{preview || "—"}</span>
      </div>

      {value && (
        <button
          type="button"
          onClick={onClear}
          className="rounded border border-rose-500/40 px-3 py-1 text-sm text-rose-400 hover:bg-rose-500/10"
        >
          Clear binding
        </button>
      )}
    </div>
  );
}
