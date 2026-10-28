import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

/** All migration/seed/test commands are locked to an explicitly named preview. */
export function previewPool(): Pool {
  const reference = process.env.VETCRED_PREVIEW_PROJECT_REF;
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const connectionString = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!reference || !supabaseUrl || !connectionString) {
    throw new Error('Set VETCRED_PREVIEW_PROJECT_REF, SUPABASE_URL and POSTGRES_URL_NON_POOLING for the isolated preview.');
  }
  const databaseUrl = new URL(connectionString);
  if (new URL(supabaseUrl).hostname !== `${reference}.supabase.co` ||
      !(databaseUrl.hostname.includes(reference) || decodeURIComponent(databaseUrl.username).includes(reference))) {
    throw new Error('Preview project reference does not match both the Auth URL and database connection.');
  }
  // Preserve certificate verification rather than allowing sslmode=require to
  // replace node-postgres TLS options with a permissive configuration.
  databaseUrl.searchParams.delete('sslmode');
  const ca = readFileSync(new URL('../supabase/certs/prod-ca-2021.crt', import.meta.url), 'utf8');
  return new Pool({ connectionString: databaseUrl.toString(), ssl: { ca, rejectUnauthorized: true }, max: 2 });
}

export async function migrate(): Promise<number> {
  const pool = previewPool();
  const client = await pool.connect();
  let count = 0;
  try {
    await client.query('select pg_advisory_lock(713663784)');
    await client.query('create schema if not exists private');
    await client.query(`create table if not exists private.schema_migrations (
      filename text primary key, checksum text not null, applied_at timestamptz not null default now()
    )`);
    await client.query('alter table private.schema_migrations enable row level security');
    await client.query('revoke all on private.schema_migrations from public,anon,authenticated');
    const directory = new URL('../supabase/migrations/', import.meta.url);
    const names = (await readdir(directory)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
    for (const filename of names) {
      const sql = await readFile(new URL(filename, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = await client.query<{ checksum: string }>('select checksum from private.schema_migrations where filename=$1', [filename]);
      if (previous.rowCount) {
        if (previous.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${filename}`);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into private.schema_migrations(filename,checksum) values($1,$2)', [filename, checksum]);
        await client.query('commit');
        count++;
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
    return count;
  } finally {
    await client.query('select pg_advisory_unlock(713663784)').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate().then(count => console.log(`Preview migration complete: ${count} applied.`)).catch(error => {
    console.error('Preview migration failed:', error instanceof Error ? error.message : 'Unknown database error');
    process.exitCode = 1;
  });
}
