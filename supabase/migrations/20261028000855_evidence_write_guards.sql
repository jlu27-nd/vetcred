-- An authenticated owner can call Supabase REST without going through Next.js.
-- Preserve evidence integrity at the database boundary as well as in API schemas.
revoke insert on public.stories,public.claims from authenticated;

create function private.guard_evidence_fields() returns trigger
language plpgsql security invoker set search_path='' as $$
declare field text; protected text[];
begin
  if tg_table_name='assets' and new.data ? 'claimId' and new.data->>'claimId' is not null then
    if not exists (select 1 from public.claims c where c.organization_id=new.organization_id and c.case_id=new.case_id and c.id::text=new.data->>'claimId') then
      raise exception 'Supporting evidence must reference a claim in this case' using errcode='23514';
    end if;
  end if;
  if current_user<>'authenticated' then return new; end if;
  if tg_table_name='assets' then
    protected:=array['machineTranscript','sample','fixtureHash'];
  elsif tg_table_name='stories' then
    protected:=array['original','proposed','sourceIds','followUp'];
  else
    protected:=array['original','proposed','sourceIds','evidenceStatus'];
    if new.data->>'reviewStatus'='counselor_reviewed' then
      raise exception 'Counselor review status is recorded only by the review workflow' using errcode='23514';
    end if;
  end if;
  foreach field in array protected loop
    if tg_op='INSERT' then
      if new.data ? field then raise exception 'Original evidence and sample identity are server controlled' using errcode='23514'; end if;
    elsif new.data->field is distinct from old.data->field then
      raise exception 'Original evidence is immutable; save a separate user revision' using errcode='23514';
    end if;
  end loop;
  return new;
end $$;

create function private.validate_source_links() returns trigger
language plpgsql security invoker set search_path='' as $$
declare source_id text; item jsonb; items jsonb; source_ids jsonb; target_case uuid;
begin
  if tg_table_name='cases' then
    target_case:=new.id;
    items:=coalesce(new.profile->'service','[]'::jsonb)||coalesce(new.profile->'education','[]'::jsonb)||coalesce(new.profile->'credentials','[]'::jsonb);
  else
    target_case:=new.case_id;
    items:=jsonb_build_array(new.data);
  end if;
  for item in select value from jsonb_array_elements(items) loop
    source_ids:=coalesce(item->'sourceIds','[]'::jsonb);
    if jsonb_typeof(source_ids)<>'array' then raise exception 'Source references must be an array' using errcode='23514'; end if;
    for source_id in select jsonb_array_elements_text(source_ids) loop
      if not exists(select 1 from public.source_segments s where s.organization_id=new.organization_id and s.case_id=target_case and s.id::text=source_id) then
        raise exception 'A source reference does not belong to this case' using errcode='23514';
      end if;
    end loop;
  end loop;
  return new;
end $$;

create trigger assets_evidence before insert or update on public.assets for each row execute function private.guard_evidence_fields();
create trigger stories_evidence before insert or update on public.stories for each row execute function private.guard_evidence_fields();
create trigger claims_evidence before insert or update on public.claims for each row execute function private.guard_evidence_fields();
create trigger stories_sources before insert or update on public.stories for each row execute function private.validate_source_links();
create trigger claims_sources before insert or update on public.claims for each row execute function private.validate_source_links();
create trigger cases_sources before insert or update on public.cases for each row execute function private.validate_source_links();
revoke all on function private.guard_evidence_fields(),private.validate_source_links() from public,anon,authenticated;
notify pgrst,'reload schema';
