import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: pubRows } = await sb
  .from('users')
  .select('id, email, display_name, supabase_auth_id, deleted_at')
  .or('email.ilike.%adefola%,email.ilike.%anife%,display_name.ilike.%adefola%,display_name.ilike.%anife%,display_name.ilike.%Adefola%,display_name.ilike.%Anife%');

console.log('users matches:', pubRows);

const { data: authList, error: e } = await sb.auth.admin.listUsers({ perPage: 200 });
if (e) { console.error(e); process.exit(1); }
const filtered = (authList?.users ?? []).filter(u => /adefola|anife/i.test(u.email ?? ''));
console.log('\nauth.users matches:', filtered.map(u => ({ id: u.id, email: u.email })));
