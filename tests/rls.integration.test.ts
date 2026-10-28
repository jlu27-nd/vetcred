import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { previewPool } from '../scripts/migrate';

// Real Postgres/RLS tests. Opt in explicitly; never silently replace with mocks.
// VETCRED_RUN_DB_TESTS=1 VETCRED_PREVIEW_PROJECT_REF=<preview-ref> pnpm test
describe.skipIf(process.env.VETCRED_RUN_DB_TESTS !== '1')('Supabase preview: real tenant, assignment and publication policies', () => {
  let pool: Pool;
  let db: PoolClient;
  const ids = Object.fromEntries(['org','otherOrg','owner','otherVeteran','counselor','unassigned','outsider','case','sameOrgCase','otherCase','asset','segment'].map(key => [key,randomUUID()]));

  async function asUser(id: string) {
    await db.query('reset role');
    await db.query('select set_config($1,$2,true)', ['request.jwt.claims',JSON.stringify({sub:id,role:'authenticated',user_metadata:{role:'counselor',organization_id:ids.org}})]);
    await db.query('set local role authenticated');
  }
  async function asAdmin() { await db.query('reset role'); }
  async function expectSqlError(action: () => Promise<unknown>, code: string) {
    await db.query('savepoint expected_error');
    try { await expect(action()).rejects.toMatchObject({code}); }
    finally { await db.query('rollback to savepoint expected_error'); }
  }
  async function approve() {
    await asAdmin();
    await db.query("update public.cases set state='ready_for_review' where id=$1",[ids.case]);
    await db.query("update public.cases set state='approved_for_sharing',approved_revision=revision where id=$1",[ids.case]);
    return (await db.query<{revision:number}>('select revision from public.cases where id=$1',[ids.case])).rows[0].revision;
  }

  beforeAll(async () => {
    pool = previewPool();
    db = await pool.connect();
    await db.query('begin');
    for (const user of ['owner','otherVeteran','counselor','unassigned','outsider']) {
      await db.query('insert into auth.users(id,email) values($1,$2)',[ids[user],`rls-${ids[user]}@vetcred.example`]);
    }
    await db.query("insert into public.organizations(id,name) values($1,'RLS test'),($2,'RLS outsider')",[ids.org,ids.otherOrg]);
    for (const user of ['owner','otherVeteran','counselor','unassigned','outsider']) {
      await db.query('insert into public.memberships(organization_id,user_id,role) values($1,$2,$3)',[user==='outsider'?ids.otherOrg:ids.org,ids[user],['counselor','unassigned'].includes(user)?'counselor':'veteran']);
    }
    await db.query('insert into public.cases(id,organization_id,owner_id) values($1,$2,$3),($4,$2,$5),($6,$7,$8)',[ids.case,ids.org,ids.owner,ids.sameOrgCase,ids.otherVeteran,ids.otherCase,ids.otherOrg,ids.outsider]);
    await db.query('insert into public.assignments(organization_id,case_id,counselor_id) values($1,$2,$3)',[ids.org,ids.case,ids.counselor]);
    await db.query("insert into public.assets(id,organization_id,case_id,kind,name,mime,size,object_key,status) values($1,$2,$3,'photo','test.png','image/png',32,$4,'ready')",[ids.asset,ids.org,ids.case,`${ids.org}/${ids.case}/${ids.asset}/original`]);
    await db.query("insert into public.source_segments(id,organization_id,case_id,asset_id,data) values($1,$2,$3,$4,$5)",[ids.segment,ids.org,ids.case,ids.asset,JSON.stringify({locator:'Photo context revision 1',text:'Original supplied words',revision:1})]);
  },30_000);
  beforeEach(async () => { await db.query('savepoint test_case'); });
  afterEach(async () => { await db.query('rollback to savepoint test_case'); });
  afterAll(async () => {
    if (db) { await db.query('rollback'); db.release(); }
    if (pool) await pool.end();
  });

  it('owners see only their case even when a second case belongs to their organization', async () => {
    await asUser(ids.owner);
    expect((await db.query('select id from public.cases order by id')).rows).toEqual([{id:ids.case}]);
    expect((await db.query('select id from public.assets')).rows).toEqual([{id:ids.asset}]);
    expect((await db.query('select id from public.source_segments')).rows).toEqual([{id:ids.segment}]);
  });
  it('an assigned counselor reads only assigned cases, and an unassigned counselor reads none', async () => {
    await asUser(ids.counselor);
    expect((await db.query('select id from public.cases')).rows).toEqual([{id:ids.case}]);
    await asUser(ids.unassigned);
    expect((await db.query('select id from public.cases')).rows).toEqual([]);
    expect((await db.query('select id from public.assets')).rows).toEqual([]);
  });
  it('a foreign organization cannot read or write this case despite forged user_metadata', async () => {
    await asUser(ids.outsider);
    expect((await db.query('select id from public.cases')).rows).toEqual([{id:ids.otherCase}]);
    expect((await db.query('update public.cases set profile=$1 where id=$2 returning id',[JSON.stringify({name:'attack'}),ids.case])).rowCount).toBe(0);
    await expectSqlError(()=>db.query('insert into public.stories(organization_id,case_id,data) values($1,$2,$3)',[ids.org,ids.case,'{}']), '42501');
  });
  it('cannot change membership, role, case ownership or approval columns with an authenticated role', async () => {
    await asUser(ids.owner);
    await expectSqlError(()=>db.query("update public.memberships set role='counselor' where user_id=$1",[ids.owner]),'42501');
    await expectSqlError(()=>db.query('update public.cases set owner_id=$1 where id=$2',[ids.outsider,ids.case]),'42501');
    await expectSqlError(()=>db.query("update public.cases set state='approved_for_sharing',approved_revision=revision where id=$1",[ids.case]),'42501');
  });
  it('allows counselor feedback but blocks counselor portfolio edits and owner-authored counselor feedback', async () => {
    await asUser(ids.counselor);
    expect((await db.query('insert into public.reviews(organization_id,case_id,author_id,data) values($1,$2,$3,$4) returning id',[ids.org,ids.case,ids.counselor,JSON.stringify({text:'Clarify your personal action.',revision:2,requestedChanges:true})])).rowCount).toBe(1);
    expect((await db.query('update public.cases set profile=$1 where id=$2',[JSON.stringify({name:'counselor edit'}),ids.case])).rowCount).toBe(0);
    expect((await db.query('update public.assets set data=$1 where id=$2',['{}',ids.asset])).rowCount).toBe(0);
    await asUser(ids.owner);
    await expectSqlError(()=>db.query('insert into public.reviews(organization_id,case_id,author_id,data) values($1,$2,$3,$4)',[ids.org,ids.case,ids.counselor,'{}']),'42501');
  });
  it('composite foreign keys prevent privileged code from linking an asset in another case', async () => {
    await expectSqlError(()=>db.query('insert into public.source_segments(organization_id,case_id,asset_id,data) values($1,$2,$3,$4)',[ids.otherOrg,ids.otherCase,ids.asset,'{}']),'23503');
    const planted = randomUUID();
    await asUser(ids.owner);
    await expectSqlError(()=>db.query("insert into public.assets(id,organization_id,case_id,kind,name,mime,size,object_key) values($1,$2,$3,'photo','x','image/png',32,$4)",[planted,ids.org,ids.case,`${ids.otherOrg}/${ids.otherCase}/${planted}/original`]),'23514');
  });
  it('source text and feedback are immutable and processing status is server-controlled', async () => {
    await expectSqlError(()=>db.query("update public.source_segments set data='{}' where id=$1",[ids.segment]),'23514');
    await asUser(ids.owner);
    await expectSqlError(()=>db.query("update public.assets set status='ready' where id=$1",[ids.asset]),'42501');
    await expectSqlError(()=>db.query("insert into public.processing_jobs(organization_id,case_id,kind,idempotency_key) values($1,$2,'transcribe','fake')",[ids.org,ids.case]),'42501');
  });
  it('direct REST-role writes cannot forge machine evidence, sample identity or counselor status', async () => {
    const claimId=randomUUID();
    const storyId=randomUUID();
    const evidence={original:'Original supplied words',proposed:'Civilian wording',sourceIds:[ids.segment],evidenceStatus:'self_reported',reviewStatus:'pending'};
    await db.query('insert into public.claims(id,organization_id,case_id,data) values($1,$2,$3,$4)',[claimId,ids.org,ids.case,evidence]);
    await db.query('insert into public.stories(id,organization_id,case_id,data) values($1,$2,$3,$4)',[storyId,ids.org,ids.case,evidence]);
    await asUser(ids.owner);
    for (const field of ['machineTranscript','sample','fixtureHash']) {
      await expectSqlError(()=>db.query('update public.assets set data=data || $1::jsonb where id=$2',[JSON.stringify({[field]:'forged'}),ids.asset]),'23514');
    }
    for (const field of ['original','proposed','evidenceStatus','reviewStatus']) {
      await expectSqlError(()=>db.query('update public.claims set data=data || $1::jsonb where id=$2',[JSON.stringify({[field]:field==='reviewStatus'?'counselor_reviewed':'forged'}),claimId]),'23514');
    }
    await expectSqlError(()=>db.query('update public.stories set data=data || $1::jsonb where id=$2',[JSON.stringify({sourceIds:[]}),storyId]),'23514');
    await expectSqlError(()=>db.query('insert into public.stories(organization_id,case_id,data) values($1,$2,$3)',[ids.org,ids.case,'{}']),'42501');
    expect((await db.query('update public.claims set data=data || $1::jsonb where id=$2 returning id',[JSON.stringify({accepted:'My corrected wording',reviewStatus:'accepted'}),claimId])).rowCount).toBe(1);
    expect((await db.query('update public.assets set data=data || $1::jsonb where id=$2 returning id',[JSON.stringify({caption:'My caption',correctedTranscript:'My corrected transcript'}),ids.asset])).rowCount).toBe(1);
  });
  it('profile and generated claims reject nonexistent or cross-case source references at the database boundary', async () => {
    await expectSqlError(()=>db.query('insert into public.claims(organization_id,case_id,data) values($1,$2,$3)',[ids.otherOrg,ids.otherCase,JSON.stringify({sourceIds:[ids.segment]})]),'23514');
    await asUser(ids.owner);
    await expectSqlError(()=>db.query('update public.cases set profile=$1 where id=$2',[JSON.stringify({service:[{sourceIds:[randomUUID()]}]}),ids.case]),'23514');
  });
  it('cannot publish a draft even through the privileged server database connection', async () => {
    await expectSqlError(()=>db.query("insert into public.portfolio_versions(organization_id,case_id,revision,snapshot) values($1,$2,2,'{}')",[ids.org,ids.case]),'23514');
    await expectSqlError(()=>db.query("update public.cases set state='approved_for_sharing',approved_revision=revision where id=$1",[ids.case]),'23514');
  });
  it('content edits invalidate approval while an existing snapshot remains immutable', async () => {
    const revision = await approve();
    const snapshot = {name:'Approved name',photos:[],stories:[]};
    const version = (await db.query<{id:string}>('insert into public.portfolio_versions(organization_id,case_id,revision,snapshot) values($1,$2,$3,$4) returning id',[ids.org,ids.case,revision,JSON.stringify(snapshot)])).rows[0].id;
    await asUser(ids.owner);
    await db.query('update public.assets set data=$1 where id=$2',[JSON.stringify({caption:'Edited after publication',selected:true}),ids.asset]);
    const current = (await db.query('select state,revision,approved_revision from public.cases where id=$1',[ids.case])).rows[0];
    expect(current).toEqual({state:'draft',revision:revision+1,approved_revision:null});
    expect((await db.query('select snapshot from public.portfolio_versions where id=$1',[version])).rows[0].snapshot).toEqual(snapshot);
    await asAdmin();
    await expectSqlError(()=>db.query("update public.portfolio_versions set snapshot='{}' where id=$1",[version]),'23514');
    await expectSqlError(()=>db.query('delete from public.portfolio_versions where id=$1',[version]),'23514');
  });
  it('anonymous role has no access to private tables, shared snapshots or share-token records', async () => {
    await db.query('set local role anon');
    for (const table of ['cases','assets','source_segments','stories','claims','reviews','processing_jobs','portfolio_versions','share_tokens','request_limits']) {
      await expectSqlError(()=>db.query(`select * from public.${table} limit 1`),'42501');
    }
  });
  it('private buckets and original-file storage policies do not expose another case', async () => {
    const buckets = await db.query("select id,public from storage.buckets where id in ('vetcred-originals','vetcred-shared') order by id");
    expect(buckets.rows).toEqual([{id:'vetcred-originals',public:false},{id:'vetcred-shared',public:false}]);
    const policies = await db.query("select policyname,cmd from pg_policies where schemaname='storage' and policyname like 'vetcred%'");
    expect(policies.rows).toEqual([{policyname:'vetcred_originals_read_case',cmd:'SELECT'}]);
  });
});
