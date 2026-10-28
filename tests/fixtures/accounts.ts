import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { previewPool } from '../../scripts/migrate';
import { defaultSettings, emptyProfile } from '../../src/lib/types';

/** A blank, unique case in the explicitly guarded preview DB; no seeded case is edited. */
export async function createIsolatedVeteran() {
  const pool = previewPool();
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const email = `documents-${randomUUID()}@vetcred.example`;
    const password = randomBytes(30).toString('base64url');
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error('Unable to create the isolated document-test account.');
    const account = { id: data.user.id, email, password, caseId: randomUUID(), organizationId: randomUUID() };
    const db = await pool.connect();
    try {
      await db.query('begin');
      await db.query('insert into organizations(id,name) values($1,$2)', [account.organizationId, 'VetCred isolated document test']);
      await db.query("insert into memberships(organization_id,user_id,role) values($1,$2,'veteran')", [account.organizationId, account.id]);
      await db.query('insert into cases(id,organization_id,owner_id,profile,settings) values($1,$2,$3,$4,$5)', [account.caseId, account.organizationId, account.id, emptyProfile, defaultSettings]);
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    } finally {
      db.release();
    }
    return account;
  } finally {
    await pool.end();
  }
}
