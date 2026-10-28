-- VetCred preview schema. Auth users and Storage are managed by Supabase.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
create table public.memberships (
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('veteran','counselor')),
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  owner_id uuid not null,
  state text not null default 'draft' check (state in ('draft','ready_for_review','changes_requested','approved_for_sharing')),
  revision integer not null default 1 check (revision > 0),
  approved_revision integer,
  is_sample boolean not null default false,
  profile jsonb not null default '{}'::jsonb check (jsonb_typeof(profile)='object'),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,id),
  foreign key (organization_id,owner_id) references public.memberships(organization_id,user_id),
  check ((state='approved_for_sharing' and approved_revision=revision) or (state<>'approved_for_sharing' and approved_revision is null))
);
create index cases_owner_idx on public.cases(owner_id,organization_id);
create table public.assignments (
  organization_id uuid not null,
  case_id uuid not null,
  counselor_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id,case_id,counselor_id),
  foreign key (organization_id,case_id) references public.cases(organization_id,id),
  foreign key (organization_id,counselor_id) references public.memberships(organization_id,user_id)
);
create index assignments_counselor_idx on public.assignments(counselor_id,organization_id,case_id);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  case_id uuid not null,
  kind text not null,
  name text not null,
  mime text not null,
  size bigint not null check (size > 0 and size <= 26214400),
  object_key text not null unique check (object_key = organization_id::text || '/' || case_id::text || '/' || id::text || '/original'),
  derivative_key text check (derivative_key is null or derivative_key=organization_id::text || '/' || case_id::text || '/' || id::text || '/share.webp'),
  status text not null default 'pending',
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,case_id,id),
  foreign key (organization_id,case_id) references public.cases(organization_id,id)
);
create table public.source_segments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  case_id uuid not null,
  asset_id uuid,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data)='object'),
  created_at timestamptz not null default now(),
  unique (organization_id,case_id,id),
  foreign key (organization_id,case_id) references public.cases(organization_id,id),
  foreign key (organization_id,case_id,asset_id) references public.assets(organization_id,case_id,id)
);
create table public.stories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  case_id uuid not null,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,case_id,id),
  foreign key (organization_id,case_id) references public.cases(organization_id,id)
);
create table public.claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  case_id uuid not null,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,case_id,id),
  foreign key (organization_id,case_id) references public.cases(organization_id,id)
);
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  case_id uuid not null,
  author_id uuid not null references auth.users(id),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data)='object'),
  created_at timestamptz not null default now(),
  foreign key (organization_id,case_id) references public.cases(organization_id,id)
);
create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  case_id uuid not null,
  asset_id uuid,
  kind text not null,
  idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_until timestamptz,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,case_id,idempotency_key),
  foreign key (organization_id,case_id) references public.cases(organization_id,id),
  foreign key (organization_id,case_id,asset_id) references public.assets(organization_id,case_id,id)
);
create table public.portfolio_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  case_id uuid not null,
  parent_id uuid,
  revision integer not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  created_at timestamptz not null default now(),
  unique (organization_id,case_id,id),
  unique (organization_id,case_id,revision),
  foreign key (organization_id,case_id) references public.cases(organization_id,id),
  foreign key (organization_id,case_id,parent_id) references public.portfolio_versions(organization_id,case_id,id)
);
create table public.share_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  case_id uuid not null,
  version_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id,case_id) references public.cases(organization_id,id),
  foreign key (organization_id,case_id,version_id) references public.portfolio_versions(organization_id,case_id,id)
);
create table public.request_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0 check (count >= 0)
);

-- No JWT user_metadata or browser-supplied role is used for access decisions.
create function private.owns_case(p_org uuid,p_case uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.cases c join public.memberships m
      on m.organization_id=c.organization_id and m.user_id=c.owner_id
    where c.id=p_case and c.organization_id=p_org
      and c.owner_id=(select auth.uid()) and m.role='veteran'
  );
$$;
create function private.is_assigned_counselor(p_org uuid,p_case uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.assignments a join public.memberships m
      on m.organization_id=a.organization_id and m.user_id=a.counselor_id
    where a.case_id=p_case and a.organization_id=p_org
      and a.counselor_id=(select auth.uid()) and m.role='counselor'
  );
$$;
create function private.can_read_case(p_org uuid,p_case uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select private.owns_case(p_org,p_case) or private.is_assigned_counselor(p_org,p_case);
$$;
revoke all on function private.owns_case(uuid,uuid),private.is_assigned_counselor(uuid,uuid),private.can_read_case(uuid,uuid) from public,anon;
grant execute on function private.owns_case(uuid,uuid),private.is_assigned_counselor(uuid,uuid),private.can_read_case(uuid,uuid) to authenticated,service_role;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.cases enable row level security;
alter table public.assignments enable row level security;
alter table public.request_limits enable row level security;
revoke all on public.organizations,public.memberships,public.cases,public.assignments,public.request_limits from anon,authenticated;
grant select on public.organizations,public.memberships,public.cases,public.assignments to authenticated;
grant update(profile,settings) on public.cases to authenticated;
create policy memberships_read_self on public.memberships for select to authenticated using (user_id=(select auth.uid()));
create policy organizations_read_member on public.organizations for select to authenticated using (exists(select 1 from public.memberships m where m.organization_id=id and m.user_id=(select auth.uid())));
create policy cases_read_authorized on public.cases for select to authenticated using (private.can_read_case(organization_id,id));
create policy cases_update_owner on public.cases for update to authenticated using (private.owns_case(organization_id,id)) with check (private.owns_case(organization_id,id));
create policy assignments_read_authorized on public.assignments for select to authenticated using (private.can_read_case(organization_id,case_id));

do $$ declare t text; begin
  foreach t in array array['assets','source_segments','stories','claims','reviews','processing_jobs','portfolio_versions','share_tokens'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy %I on public.%I for select to authenticated using (private.can_read_case(organization_id,case_id))',t||'_read_case',t);
    execute format('create index %I on public.%I(organization_id,case_id)',t||'_case_idx',t);
  end loop;
  foreach t in array array['assets','stories','claims'] loop
    execute format('grant insert,update,delete on public.%I to authenticated',t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.owns_case(organization_id,case_id))',t||'_insert_owner',t);
    execute format('create policy %I on public.%I for update to authenticated using (private.owns_case(organization_id,case_id)) with check (private.owns_case(organization_id,case_id))',t||'_update_owner',t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.owns_case(organization_id,case_id))',t||'_delete_owner',t);
  end loop;
end $$;
revoke update on public.assets from authenticated;
grant update(data,name) on public.assets to authenticated;
grant insert on public.reviews to authenticated;
create policy reviews_insert_assigned on public.reviews for insert to authenticated with check (author_id=(select auth.uid()) and private.is_assigned_counselor(organization_id,case_id));
-- Source text, machine transcripts, jobs, publication and tokens are written only
-- by the server after authorization. Browser JWTs cannot mint publication state.
grant all on public.organizations,public.memberships,public.cases,public.assignments,public.assets,public.source_segments,public.stories,public.claims,public.reviews,public.processing_jobs,public.portfolio_versions,public.share_tokens,public.request_limits to service_role;

create function private.protect_case() returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>old.id or new.organization_id<>old.organization_id or new.owner_id<>old.owner_id or new.is_sample<>old.is_sample then
    raise exception 'Case identity is immutable' using errcode='23514';
  end if;
  if new.profile is distinct from old.profile or new.settings is distinct from old.settings then
    new.revision:=old.revision+1; new.state:='draft'; new.approved_revision:=null;
  end if;
  if new.state='approved_for_sharing' and old.state<>'approved_for_sharing' and old.state<>'ready_for_review' then
    raise exception 'Submit this revision for review before approval' using errcode='23514';
  end if;
  new.updated_at:=now();
  return new;
end $$;
create trigger cases_protect before update on public.cases for each row execute function private.protect_case();

create function private.guard_asset_insert() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user='authenticated' and (new.status<>'pending' or new.derivative_key is not null) then
    raise exception 'New uploads must await server validation' using errcode='23514';
  end if;
  return new;
end $$;
create trigger assets_pending before insert on public.assets for each row execute function private.guard_asset_insert();

create function private.protect_row_identity() returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>old.id or new.organization_id<>old.organization_id or new.case_id<>old.case_id then
    raise exception 'Record identity is immutable' using errcode='23514';
  end if;
  if tg_table_name='assets' and (to_jsonb(new)->'object_key') is distinct from (to_jsonb(old)->'object_key') then
    raise exception 'Original object key is immutable' using errcode='23514';
  end if;
  new.updated_at:=now();
  return new;
end $$;
create function private.touch_case() returns trigger language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_case uuid;
begin
  if tg_op='DELETE' then v_org:=old.organization_id; v_case:=old.case_id;
  else v_org:=new.organization_id; v_case:=new.case_id; end if;
  update public.cases set revision=revision+1,state='draft',approved_revision=null,updated_at=now()
    where organization_id=v_org and id=v_case;
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['assets','stories','claims'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.protect_row_identity()',t||'_identity',t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.touch_case()',t||'_touch_case',t);
  end loop;
end $$;

create function private.reject_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'This evidence or published snapshot is immutable' using errcode='23514'; end $$;
create trigger source_segments_immutable before update or delete on public.source_segments for each row execute function private.reject_mutation();
create trigger reviews_immutable before update or delete on public.reviews for each row execute function private.reject_mutation();
create trigger versions_immutable before update or delete on public.portfolio_versions for each row execute function private.reject_mutation();
create function private.check_publication() returns trigger language plpgsql set search_path='' as $$
declare c public.cases;
begin
  select * into c from public.cases where organization_id=new.organization_id and id=new.case_id for update;
  if c.state is distinct from 'approved_for_sharing' or c.approved_revision is distinct from new.revision or c.revision is distinct from new.revision then
    raise exception 'Publication requires approval of the current revision' using errcode='23514';
  end if;
  return new;
end $$;
create trigger versions_approval before insert on public.portfolio_versions for each row execute function private.check_publication();
revoke all on function private.protect_case(),private.guard_asset_insert(),private.protect_row_identity(),private.touch_case(),private.reject_mutation(),private.check_publication() from public,anon,authenticated;

-- Upload capabilities are issued by an authorized server. There is deliberately
-- no anonymous/authenticated INSERT/UPDATE storage policy and no public bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values
 ('vetcred-originals','vetcred-originals',false,26214400,array['image/jpeg','image/png','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/webm','video/webm','video/mp4','audio/ogg','audio/flac']),
 ('vetcred-shared','vetcred-shared',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy vetcred_originals_read_case on storage.objects for select to authenticated using (
  bucket_id='vetcred-originals' and exists(select 1 from public.assets a where a.object_key=name and private.can_read_case(a.organization_id,a.case_id))
);
notify pgrst,'reload schema';
