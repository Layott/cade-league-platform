import { inputClass, selectClass } from "@/components/admin/FormField";

/**
 * Plan 10 — single-row form for one squad item. Controlled-component-lite:
 * caller passes the slot_index (0-22) and reads values via the standard
 * form POST. Client-side mirror validation is intentionally minimal — the
 * server schema is the source of truth.
 */
export function ItemRow({ slotIndex }: { slotIndex: number }) {
  const kind = slotIndex <= 10 ? "XI" : "Bench";
  return (
    <fieldset
      data-testid={`item-row-${slotIndex}`}
      className="grid grid-cols-12 gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-2"
    >
      <div className="col-span-1 flex items-center justify-center font-mono text-[11px] text-[var(--chalk-3)]">
        {kind}·{slotIndex}
      </div>
      <input
        name={`items.${slotIndex}.name`}
        placeholder="Player name"
        className={inputClass + " col-span-3"}
        required={slotIndex <= 10}
      />
      <input
        type="number"
        name={`items.${slotIndex}.rating`}
        placeholder="OVR"
        min={1}
        max={99}
        className={inputClass + " col-span-1"}
      />
      <input
        name={`items.${slotIndex}.position`}
        placeholder="Pos"
        className={inputClass + " col-span-1"}
      />
      <input
        type="number"
        name={`items.${slotIndex}.value`}
        placeholder="Coins"
        min={0}
        className={inputClass + " col-span-2"}
      />
      <select
        name={`items.${slotIndex}.itemType`}
        className={selectClass + " col-span-2"}
        defaultValue="gold"
      >
        <option value="gold">Gold</option>
        <option value="silver">Silver</option>
        <option value="bronze">Bronze</option>
        <option value="hero">Hero</option>
        <option value="icon">Icon</option>
        <option value="legend">Legend</option>
        <option value="special">Special</option>
        <option value="other">Other</option>
      </select>
      <input
        name={`items.${slotIndex}.nationalityFlag`}
        placeholder="NG/GB/…"
        maxLength={6}
        className={inputClass + " col-span-2"}
      />
      <input type="hidden" name={`items.${slotIndex}.slotIndex`} value={slotIndex} />
    </fieldset>
  );
}
