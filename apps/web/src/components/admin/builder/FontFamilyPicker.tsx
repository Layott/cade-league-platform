"use client";

const CURATED = ["Agharti", "Quedora", "Inter", "JetBrains Mono"] as const;

export type UploadedFontMeta = { id: string; familyName: string };

export function FontFamilyPicker({
  value,
  uploaded,
  onChange,
}: {
  value: string;
  uploaded: UploadedFontMeta[];
  onChange: (next: string) => void;
}) {
  if (uploaded.length === 0) {
    return (
      <select
        aria-label="Font family"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
      >
        {CURATED.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    );
  }
  return (
    <select
      aria-label="Font family"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
    >
      <optgroup label="Curated">
        {CURATED.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </optgroup>
      <optgroup label="Custom">
        {uploaded.map((u) => (
          <option key={u.id} value={u.familyName}>
            {u.familyName}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
