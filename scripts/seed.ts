import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { previewPool } from './migrate';
import { emptyProfile, defaultSettings } from '../src/lib/types';

export type SeedAccount = { id: string; email: string; password: string };
export type SeedAccounts = Record<'veteran' | 'counselor' | 'outsider' | 'unassigned', SeedAccount> & {
  caseId: string;
  outsiderCaseId: string;
  organizationId: string;
  outsiderOrganizationId: string;
};
const identities = {
  veteran: { email: 'veteran@vetcred.example', role: 'veteran', id: 'b1000000-0000-4000-8000-000000000001' },
  counselor: { email: 'counselor@vetcred.example', role: 'counselor', id: 'b1000000-0000-4000-8000-000000000002' },
  outsider: { email: 'outsider@vetcred.example', role: 'veteran', id: 'b1000000-0000-4000-8000-000000000003' },
  unassigned: { email: 'unassigned@vetcred.example', role: 'counselor', id: 'b1000000-0000-4000-8000-000000000004' },
} as const;

/** Idempotent, blank live cases. Sample bootstrap creates its own isolated cases. */
export async function seed(): Promise<SeedAccounts> {
  const pool = previewPool(); // Enforce isolated-preview guard before Auth writes.
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { await pool.end(); throw new Error('Preview Supabase URL and server secret key are required.'); }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const output = new URL('../work/seed-accounts.json', import.meta.url);
  let previous: Partial<SeedAccounts> = {};
  try { previous = JSON.parse(await readFile(output, 'utf8')); } catch { /* First seed. */ }
  const accounts: Partial<SeedAccounts> = {};
  const existing = new Map<string, string>();
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`Unable to list seed users (${error.status ?? 'Auth error'}).`);
    for (const user of data.users) if (user.email) existing.set(user.email, user.id);
    if (data.users.length < 100) break;
  }
  try {
    for (const name of Object.keys(identities) as (keyof typeof identities)[]) {
      const identity = identities[name];
      const password = previous[name]?.password ?? randomBytes(30).toString('base64url');
      const existingId = existing.get(identity.email);
      if (existingId) {
        // Keep a known password stable, or recover a missing local credential file.
        if (!previous[name]?.password) {
          const { error } = await admin.auth.admin.updateUserById(existingId, { password, email_confirm: true });
          if (error) throw new Error(`Unable to recover ${name} seed account.`);
        }
        accounts[name] = { id: existingId, email: identity.email, password };
      } else {
        const { data, error } = await admin.auth.admin.createUser({ email: identity.email, password, email_confirm: true });
        if (error || !data.user) throw new Error(`Unable to create ${name} seed account (${error?.status ?? 'Auth error'}).`);
        accounts[name] = { id: data.user.id, email: identity.email, password };
      }
    }
    const result = accounts as SeedAccounts;
    result.organizationId = 'a1000000-0000-4000-8000-000000000001';
    result.outsiderOrganizationId = 'a1000000-0000-4000-8000-000000000002';
    result.caseId = 'c1000000-0000-4000-8000-000000000001';
    result.outsiderCaseId = 'c1000000-0000-4000-8000-000000000002';
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`insert into public.organizations(id,name) values($1,'VetCred Preview'),($2,'Isolation Test Organization') on conflict(id) do nothing`, [result.organizationId, result.outsiderOrganizationId]);
      for (const name of Object.keys(identities) as (keyof typeof identities)[]) {
        await client.query(`insert into public.memberships(organization_id,user_id,role) values($1,$2,$3) on conflict do nothing`, [name === 'outsider' ? result.outsiderOrganizationId : result.organizationId, result[name].id, identities[name].role]);
      }
      await client.query(`insert into public.cases(id,organization_id,owner_id,profile,settings)
        values($1,$2,$3,$7,$8),($4,$5,$6,$7,$8) on conflict(id) do update set
          profile=case when public.cases.profile='{}'::jsonb then excluded.profile else public.cases.profile end,
          settings=case when public.cases.settings='{}'::jsonb then excluded.settings else public.cases.settings end`,
        [result.caseId,result.organizationId,result.veteran.id,result.outsiderCaseId,result.outsiderOrganizationId,result.outsider.id,emptyProfile,defaultSettings]);
      await client.query(`insert into public.assignments(organization_id,case_id,counselor_id) values($1,$2,$3) on conflict do nothing`, [result.organizationId,result.caseId,result.counselor.id]);
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; }
    finally { client.release(); }
    await mkdir(new URL('../work/', import.meta.url), { recursive: true });
    await writeFile(output, JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed().then(() => console.log('Preview accounts ready. Credentials saved only to ignored work/seed-accounts.json.')).catch(error => {
    console.error('Preview seed failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exitCode = 1;
  });
}
