import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

const SHARED_PASSWORD = 'dev-player-2026';
const ADMIN_EMAIL = 'admin@cade.local';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: rows, error } = await sb
  .from('users')
  .select('id, email, supabase_auth_id')
  .like('email', '%@cade.local')
  .neq('email', ADMIN_EMAIL)
  .is('deleted_at', null)
  .order('email');
if (error) { console.error(error); process.exit(1); }

console.log(`Found ${rows.length} non-admin @cade.local users. Resetting passwords to '${SHARED_PASSWORD}'.`);

let ok = 0, fail = 0;
for (const r of rows) {
  if (!r.supabase_auth_id) {
    console.log(`SKIP ${r.email} — no supabase_auth_id`);
    fail++;
    continue;
  }
  const { error: e } = await sb.auth.admin.updateUserById(r.supabase_auth_id, {
    password: SHARED_PASSWORD,
  });
  if (e) {
    console.log(`FAIL ${r.email} — ${e.message}`);
    fail++;
  } else {
    console.log(`OK   ${r.email}`);
    ok++;
  }
}
console.log(`\nDone. ok=${ok} fail=${fail}`);
