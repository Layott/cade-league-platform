import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  FormField,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/admin/FormField";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { getOrgById } from "@/server/orgs";
import { recordLedgerEntryAction } from "./actions";

export const dynamic = "force-dynamic";

function fmtCoins(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(n));
}

async function resolveGate() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const svc = getServiceRoleSupabase();
  try {
    await requirePermAsync(
      svc,
      { userId: pub.id, roles },
      "orgs.ledger.write",
    );
  } catch (e) {
    if (e instanceof PermissionError) {
      throw new Error("Forbidden: orgs.ledger.write");
    }
    throw e;
  }
  return svc;
}

export default async function NewLedgerEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sb = await resolveGate();
  const { id } = await params;
  const org = await getOrgById(sb, id);
  if (!org) return notFound();

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={org.name}
        title="Record ledger entry"
        description="Deposits/topups credit the balance; fine deductions debit it. Use an adjustment entry (with explicit direction) to correct a prior mistake."
      />

      <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
        <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Previous balance
        </div>
        <div className="mt-1 font-mono tabular text-2xl text-[var(--chalk-0)]">
          {fmtCoins(org.caution_fee_balance_coins)}
        </div>
      </div>

      <form
        action={recordLedgerEntryAction}
        className="space-y-5"
        data-testid="ledger-new-form"
      >
        <input type="hidden" name="orgId" value={org.id} />
        <FormField label="Entry type">
          <select
            name="entryType"
            required
            defaultValue="deposit"
            className={selectClass}
            data-testid="ledger-entry-type"
          >
            <option value="deposit">deposit (credit)</option>
            <option value="topup">topup (credit)</option>
            <option value="fine_deduction">fine_deduction (debit)</option>
            <option value="adjustment">adjustment</option>
          </select>
        </FormField>

        <FormField
          label="Direction (adjustment only)"
          hint="Leave blank unless Entry type = adjustment."
        >
          <select
            name="direction"
            defaultValue=""
            className={selectClass}
            data-testid="ledger-direction"
          >
            <option value="">— auto —</option>
            <option value="credit">credit (+)</option>
            <option value="debit">debit (−)</option>
          </select>
        </FormField>

        <FormField label="Amount (coins)">
          <input
            type="number"
            name="amountCoins"
            min={1}
            step={1}
            required
            className={inputClass}
            data-testid="ledger-amount"
          />
        </FormField>

        <FormField
          label="Reference"
          hint="Short explanation shown on the ledger row."
        >
          <textarea
            name="reference"
            maxLength={500}
            rows={2}
            className={textareaClass}
            data-testid="ledger-reference"
            placeholder="e.g. initial caution fee for 2025-26"
          />
        </FormField>

        <div className="flex items-center gap-3">
          <PrimaryButton type="submit" data-testid="ledger-submit">
            Record entry
          </PrimaryButton>
          <Link href={`/admin/people/orgs/${org.id}`}>
            <SecondaryButton type="button">Cancel</SecondaryButton>
          </Link>
        </div>
      </form>
    </div>
  );
}
