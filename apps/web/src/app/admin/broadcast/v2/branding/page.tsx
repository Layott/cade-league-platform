import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { PrimaryButton, DangerButton } from "@/components/admin/buttons";
import { FormField, inputClass } from "@/components/admin/FormField";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  getBrandConfig,
  listAllBrandAssets,
  DEFAULT_PARTNER_SEED,
} from "@/server/branding/read";
import {
  saveBrandColorsAction,
  saveBrandAssetAction,
  toggleBrandAssetVisibleAction,
  deleteBrandAssetAction,
} from "./actions";

export const dynamic = "force-dynamic";

async function resolveAdmin() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/broadcast/v2/branding");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/broadcast/v2/branding");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(
      sb,
      { userId: pub.id, roles },
      "branding.manage",
    );
  } catch (err) {
    if (err instanceof PermissionError) throw err;
    throw err;
  }
  return sb;
}

const PRIMARY_SLOTS: Array<{ slot: string; label: string; hint: string }> = [
  { slot: "primary.cade", label: "CADE Esports", hint: "Main league mark" },
  { slot: "primary.gameevo", label: "GameEvo", hint: "Parent brand" },
  {
    slot: "primary.pro_league",
    label: "Pro League",
    hint: "Competition identity",
  },
];

export default async function BrandingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sb = await resolveAdmin();
  const sp = await searchParams;
  const activeTab = sp.tab === "colors" ? "colors" : "logos";

  const [config, allAssets] = await Promise.all([
    getBrandConfig(sb),
    listAllBrandAssets(sb),
  ]);

  const assetsBySlot = new Map(allAssets.map((a) => [a.slot, a]));
  const partnerAssets = allAssets.filter((a) => a.slot.startsWith("partner."));

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Site Manager"
        title="Branding"
        description="Logos, color palette, and partner marks. Changes apply to the public site + overlay templates that read getBrandConfig() at render time."
      />

      <nav className="flex gap-1 border-b border-[var(--ink-4)]">
        <TabLink href="/admin/broadcast/v2/branding?tab=logos" label="Logos" active={activeTab === "logos"} />
        <TabLink
          href="/admin/broadcast/v2/branding?tab=colors"
          label="Colors & Fonts"
          active={activeTab === "colors"}
        />
      </nav>

      {activeTab === "logos" ? (
        <LogosTab
          primarySlots={PRIMARY_SLOTS}
          partnerAssets={partnerAssets}
          assetsBySlot={assetsBySlot}
        />
      ) : (
        <ColorsFontsTab
          primaryColor={config.primaryColor}
          secondaryColor={config.secondaryColor}
        />
      )}
    </div>
  );
}

function TabLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <a
      href={href}
      className={
        "relative px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors " +
        (active
          ? "text-[var(--chalk-0)]"
          : "text-[var(--chalk-3)] hover:text-[var(--chalk-0)]")
      }
      aria-current={active ? "page" : undefined}
    >
      {label}
      <span
        aria-hidden
        className={
          "pointer-events-none absolute inset-x-4 -bottom-[1px] h-[2px] transition-all " +
          (active ? "bg-[var(--signal)]" : "bg-transparent")
        }
      />
    </a>
  );
}

function LogosTab({
  primarySlots,
  partnerAssets,
  assetsBySlot,
}: {
  primarySlots: typeof PRIMARY_SLOTS;
  partnerAssets: Awaited<ReturnType<typeof listAllBrandAssets>>;
  assetsBySlot: Map<string, Awaited<ReturnType<typeof listAllBrandAssets>>[number]>;
}) {
  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-4 font-display text-lg font-bold text-[var(--chalk-0)]">
          Primary logos
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {primarySlots.map((s) => {
            const asset = assetsBySlot.get(s.slot);
            return (
              <BrandSlotCard key={s.slot} slot={s.slot} label={s.label} hint={s.hint} asset={asset ?? null} />
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-bold text-[var(--chalk-0)]">
            Partner logos
          </h2>
          <span className="text-[11px] text-[var(--chalk-3)]">
            Stored in the <code>brand-logos</code> storage bucket.
          </span>
        </div>

        {partnerAssets.length === 0 && DEFAULT_PARTNER_SEED.length > 0 ? (
          <div className="mb-4 rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-4 text-xs text-[var(--chalk-3)]">
            No partner rows yet. Use the form below to register the first one — slot names like <code>partner.trace_tv</code>, <code>partner.gamepride</code>.
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {partnerAssets.map((a) => (
            <BrandSlotCard
              key={a.slot}
              slot={a.slot}
              label={a.label ?? a.slot.replace("partner.", "")}
              hint={`Order ${a.displayOrder} · ${a.visible ? "live" : "hidden"}`}
              asset={a}
            />
          ))}
        </div>

        <details className="mt-6 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5" open>
          <summary className="cursor-pointer font-display text-sm font-bold text-[var(--chalk-0)]">
            Add or update a partner logo
          </summary>
          <form
            action={saveBrandAssetAction}
            className="mt-4 grid gap-3 sm:grid-cols-2"
          >
            <FormField label="Slot">
              <input
                name="slot"
                required
                placeholder="partner.trace_tv"
                pattern="^(primary|partner)\.[a-z][a-z0-9_]*$"
                className={inputClass}
              />
            </FormField>
            <FormField label="Label">
              <input
                name="label"
                placeholder="Trace TV"
                className={inputClass}
              />
            </FormField>
            <FormField label="Storage path" hint="Path inside brand-logos bucket (upload via Supabase dashboard for now)">
              <input
                name="storagePath"
                required
                placeholder="partners/trace-tv.png"
                className={inputClass}
              />
            </FormField>
            <FormField label="Display order">
              <input
                type="number"
                name="displayOrder"
                defaultValue={0}
                className={inputClass}
              />
            </FormField>
            <label className="flex items-center gap-2 text-xs text-[var(--chalk-1)]">
              <input type="checkbox" name="visible" defaultChecked />
              <span>Visible on public site</span>
            </label>
            <div className="sm:col-span-2">
              <PrimaryButton type="submit">Save logo</PrimaryButton>
            </div>
          </form>
        </details>
      </section>
    </div>
  );
}

function BrandSlotCard({
  slot,
  label,
  hint,
  asset,
}: {
  slot: string;
  label: string;
  hint: string;
  asset: Awaited<ReturnType<typeof listAllBrandAssets>>[number] | null;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-display text-sm font-bold text-[var(--chalk-0)]">
            {label}
          </div>
          <div className="text-[11px] text-[var(--chalk-3)]">{hint}</div>
          <div className="mt-1 font-mono text-[11px] text-[var(--chalk-3)]">
            {slot}
          </div>
        </div>
        {asset ? (
          <StatusPill tone={asset.visible ? "signal" : "muted"}>
            {asset.visible ? "Live" : "Hidden"}
          </StatusPill>
        ) : (
          <StatusPill tone="neutral">Default</StatusPill>
        )}
      </div>
      <div className="flex h-24 items-center justify-center rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-1)] p-2">
        {asset?.publicUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.publicUrl}
            alt={label}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
            No upload yet
          </span>
        )}
      </div>
      {asset ? (
        <div className="flex gap-2">
          <form action={toggleBrandAssetVisibleAction} className="flex-1">
            <input type="hidden" name="id" value={asset.id} />
            <input
              type="hidden"
              name="visible"
              value={asset.visible ? "off" : "on"}
            />
            <button
              type="submit"
              className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)]"
            >
              {asset.visible ? "Hide" : "Show"}
            </button>
          </form>
          <form action={deleteBrandAssetAction}>
            <input type="hidden" name="id" value={asset.id} />
            <DangerButton size="sm" type="submit">
              Delete
            </DangerButton>
          </form>
        </div>
      ) : (
        <form action={saveBrandAssetAction} className="flex flex-col gap-2">
          <input type="hidden" name="slot" value={slot} />
          <input
            name="storagePath"
            placeholder="path inside brand-logos bucket"
            required
            className={inputClass}
          />
          <PrimaryButton size="sm" type="submit">
            Register upload path
          </PrimaryButton>
        </form>
      )}
    </div>
  );
}

function ColorsFontsTab({
  primaryColor,
  secondaryColor,
}: {
  primaryColor: string;
  secondaryColor: string;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <form
        action={saveBrandColorsAction}
        className="space-y-5 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6"
      >
        <h2 className="font-display text-lg font-bold text-[var(--chalk-0)]">
          Brand palette
        </h2>
        <p className="text-xs text-[var(--chalk-3)]">
          Applies on the next request. Hex only — overlay pages continue to
          read <code>BRAND_TOKENS</code> until they opt into
          <code>getBrandConfig()</code>.
        </p>

        <FormField label="Primary color" hint="Used for signal accents, active nav, hero buttons.">
          <div className="flex gap-2">
            <input
              type="color"
              name="primaryColor"
              defaultValue={primaryColor}
              className="h-10 w-16 rounded-sm border border-[var(--ink-4)] bg-transparent"
            />
            <input
              type="text"
              defaultValue={primaryColor}
              readOnly
              className={inputClass + " font-mono"}
            />
          </div>
        </FormField>

        <FormField label="Secondary color" hint="Complementary accent used on highlights, deductions, rare CTAs.">
          <div className="flex gap-2">
            <input
              type="color"
              name="secondaryColor"
              defaultValue={secondaryColor}
              className="h-10 w-16 rounded-sm border border-[var(--ink-4)] bg-transparent"
            />
            <input
              type="text"
              defaultValue={secondaryColor}
              readOnly
              className={inputClass + " font-mono"}
            />
          </div>
        </FormField>

        <PrimaryButton type="submit">Save palette</PrimaryButton>
      </form>

      <div className="space-y-5 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6">
        <h2 className="font-display text-lg font-bold text-[var(--chalk-0)]">
          Preview
        </h2>
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-4">
          <div
            className="mb-3 inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em]"
            style={{
              backgroundColor: primaryColor,
              color: "#000",
            }}
          >
            Primary button
          </div>
          <div
            className="inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em]"
            style={{
              borderColor: secondaryColor,
              color: secondaryColor,
            }}
          >
            Secondary accent
          </div>
          <p
            className="mt-4 text-sm"
            style={{ color: primaryColor }}
          >
            This line renders with the primary colour.
          </p>
        </div>
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-4">
          <h3 className="mb-2 font-display text-sm font-bold text-[var(--chalk-0)]">
            Fonts
          </h3>
          <p className="font-display text-base text-[var(--chalk-0)]">
            Display — Agharti · CADE ESPORTS 2025/26
          </p>
          <p className="text-sm text-[var(--chalk-1)]">
            Body — Inter · The quick brown fox jumps over 13 lazy competitors.
          </p>
          <p className="font-mono text-[12px] text-[var(--chalk-2)]">
            Mono — JetBrains · 10_000_000 coins · -3 pts
          </p>
          <p className="mt-2 text-[11px] text-[var(--chalk-3)]">
            Swapping fonts requires a redeploy (loaded via <code>next/font/local</code>).
          </p>
        </div>
      </div>
    </div>
  );
}
