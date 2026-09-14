-- For Phil — run this in the Supabase SQL editor (once per project).
-- Then create one Auth user whose password is the family PIN:
--   Authentication → Users → Add user
--   Email: the same address as familyEmail in config.js
--   Password: the shared PIN
-- Turn off Confirm email (Authentication → Providers → Email) so that user can sign in immediately.

create extension if not exists pgcrypto;

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  memory_care text not null default '',
  address text not null default '',
  zip text not null default '',
  drive_minutes text not null default '',
  phone text not null default '',
  capacity text not null default '',
  unit_type text not null default '',
  monthly_cost text not null default '',
  key_services text not null default '',
  place_for_mom_top_ten boolean not null default false,
  status text not null default 'not-started',
  claimed_by text[] not null default '{}',
  next_step text not null default '',
  next_date date,
  action_kind text not null default '',
  action_time time,
  last_contact_by text not null default '',
  last_contact_at timestamptz,
  waitlist_date text not null default '',
  estimated_wait text not null default '',
  deposit text not null default '',
  not_a_fit_reason text not null default '',
  admissions_contact text not null default '',
  locked_unit text not null default '',
  dementia_staff text not null default '',
  nurse_on_site text not null default '',
  wandering_protocol text not null default '',
  memory_care_beds text not null default '',
  medicaid_transition text not null default '',
  medicaid_beds text not null default '',
  rate_includes text not null default '',
  visiting_hours text not null default '',
  latest_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.call_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  facility_name text not null default '',
  who text not null default '',
  action text not null default '',
  note text not null default '',
  status text not null default ''
);

create index if not exists call_logs_created_at_idx on public.call_logs (created_at desc);
create index if not exists call_logs_facility_name_idx on public.call_logs (facility_name);

insert into public.people (name) values
  ('Rhys'),
  ('Janet'),
  ('Bill'),
  ('Alice'),
  ('Fred'),
  ('Ben'),
  ('Emily'),
  ('Grace')
on conflict (name) do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists facilities_set_updated_at on public.facilities;
create trigger facilities_set_updated_at
  before update on public.facilities
  for each row execute procedure public.set_updated_at();

create or replace function public.claim_facility(p_name text, p_who text)
returns void
language plpgsql
set search_path = public
as $$
begin
  p_name := trim(both from coalesce(p_name, ''));
  p_who := trim(both from coalesce(p_who, ''));
  if p_who = '' then
    raise exception 'Pick your name before marking a facility as started.';
  end if;
  update public.facilities
  set claimed_by = case
    when p_who = any(claimed_by) then claimed_by
    else array_append(claimed_by, p_who)
  end
  where name = p_name;
  if not found then
    raise exception 'Could not find % in facilities.', p_name;
  end if;
end;
$$;

create or replace function public.release_facility(p_name text, p_who text)
returns void
language plpgsql
set search_path = public
as $$
begin
  p_name := trim(both from coalesce(p_name, ''));
  p_who := trim(both from coalesce(p_who, ''));
  update public.facilities
  set claimed_by = array_remove(claimed_by, p_who)
  where name = p_name;
  if not found then
    raise exception 'Could not find % in facilities.', p_name;
  end if;
end;
$$;

create or replace function public.add_person(p_name text)
returns void
language plpgsql
set search_path = public
as $$
begin
  p_name := trim(both from coalesce(p_name, ''));
  if p_name = '' then
    raise exception 'Name is empty.';
  end if;
  insert into public.people (name) values (p_name)
  on conflict (name) do nothing;
end;
$$;

create or replace function public.save_facility(payload jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_name text := trim(both from coalesce(payload->>'name', ''));
  v_who text := trim(both from coalesce(payload->>'who', ''));
  v_note text := trim(both from coalesce(payload->>'note', ''));
  v_action text := coalesce(nullif(trim(both from coalesce(payload->>'action_label', '')), ''), 'Updated');
  v_status text := coalesce(payload->>'status', '');
  v_summary text;
  v_bits text[] := '{}';
begin
  if v_name = '' then
    raise exception 'Missing facility name.';
  end if;

  update public.facilities set
    status = case when payload ? 'status' then coalesce(payload->>'status', '') else status end,
    next_step = case when payload ? 'next_step' then coalesce(payload->>'next_step', '') else next_step end,
    next_date = case
      when not (payload ? 'next_date') then next_date
      when nullif(trim(both from coalesce(payload->>'next_date', '')), '') is null then null
      else (payload->>'next_date')::date
    end,
    action_kind = case when payload ? 'action_kind' then coalesce(payload->>'action_kind', '') else action_kind end,
    action_time = case
      when not (payload ? 'action_time') then action_time
      when nullif(trim(both from coalesce(payload->>'action_time', '')), '') is null then null
      else (payload->>'action_time')::time
    end,
    waitlist_date = case when payload ? 'waitlist_date' then coalesce(payload->>'waitlist_date', '') else waitlist_date end,
    estimated_wait = case when payload ? 'estimated_wait' then coalesce(payload->>'estimated_wait', '') else estimated_wait end,
    deposit = case when payload ? 'deposit' then coalesce(payload->>'deposit', '') else deposit end,
    not_a_fit_reason = case when payload ? 'not_a_fit_reason' then coalesce(payload->>'not_a_fit_reason', '') else not_a_fit_reason end,
    admissions_contact = case when payload ? 'admissions_contact' then coalesce(payload->>'admissions_contact', '') else admissions_contact end,
    locked_unit = case when payload ? 'locked_unit' then coalesce(payload->>'locked_unit', '') else locked_unit end,
    dementia_staff = case when payload ? 'dementia_staff' then coalesce(payload->>'dementia_staff', '') else dementia_staff end,
    nurse_on_site = case when payload ? 'nurse_on_site' then coalesce(payload->>'nurse_on_site', '') else nurse_on_site end,
    wandering_protocol = case when payload ? 'wandering_protocol' then coalesce(payload->>'wandering_protocol', '') else wandering_protocol end,
    memory_care_beds = case when payload ? 'memory_care_beds' then coalesce(payload->>'memory_care_beds', '') else memory_care_beds end,
    medicaid_transition = case when payload ? 'medicaid_transition' then coalesce(payload->>'medicaid_transition', '') else medicaid_transition end,
    medicaid_beds = case when payload ? 'medicaid_beds' then coalesce(payload->>'medicaid_beds', '') else medicaid_beds end,
    rate_includes = case when payload ? 'rate_includes' then coalesce(payload->>'rate_includes', '') else rate_includes end,
    visiting_hours = case when payload ? 'visiting_hours' then coalesce(payload->>'visiting_hours', '') else visiting_hours end,
    latest_note = case when payload ? 'latest_note' then coalesce(payload->>'latest_note', '') else latest_note end,
    last_contact_by = case
      when v_who <> '' and (
        (payload ? 'status' and nullif(payload->>'status', '') is not null)
        or v_note <> ''
        or (payload ? 'next_step' and nullif(payload->>'next_step', '') is not null)
        or (payload ? 'next_date' and nullif(payload->>'next_date', '') is not null)
        or (payload ? 'action_kind' and nullif(payload->>'action_kind', '') is not null)
      ) then v_who
      else last_contact_by
    end,
    last_contact_at = case
      when v_who <> '' and (
        (payload ? 'status' and nullif(payload->>'status', '') is not null)
        or v_note <> ''
        or (payload ? 'next_step' and nullif(payload->>'next_step', '') is not null)
        or (payload ? 'next_date' and nullif(payload->>'next_date', '') is not null)
        or (payload ? 'action_kind' and nullif(payload->>'action_kind', '') is not null)
      ) then now()
      else last_contact_at
    end
  where name = v_name;

  if not found then
    raise exception 'Could not find % in facilities.', v_name;
  end if;

  if v_note <> '' then
    insert into public.call_logs (facility_name, who, action, note, status)
    values (v_name, v_who, v_action, v_note, v_status);
  elsif (payload ? 'status' and nullif(payload->>'status', '') is not null)
     or (payload ? 'next_step' and nullif(payload->>'next_step', '') is not null)
     or (payload ? 'next_date' and nullif(payload->>'next_date', '') is not null)
     or (payload ? 'action_kind' and nullif(payload->>'action_kind', '') is not null) then
    if payload ? 'status' and nullif(payload->>'status', '') is not null then
      v_bits := array_append(v_bits, 'Status: ' || (payload->>'status'));
    end if;
    if payload ? 'action_kind' and nullif(trim(both from payload->>'action_kind'), '') is not null then
      v_bits := array_append(v_bits, 'Action: ' || trim(both from payload->>'action_kind'));
    end if;
    if payload ? 'next_step' and nullif(trim(both from payload->>'next_step'), '') is not null then
      v_bits := array_append(v_bits, 'Next: ' || trim(both from payload->>'next_step'));
    end if;
    if payload ? 'next_date' and nullif(trim(both from payload->>'next_date'), '') is not null then
      v_bits := array_append(
        v_bits,
        'On ' || trim(both from payload->>'next_date')
          || coalesce(' ' || nullif(trim(both from payload->>'action_time'), ''), '')
      );
    end if;
    v_summary := coalesce(nullif(array_to_string(v_bits, ' · '), ''), 'Saved changes.');
    insert into public.call_logs (facility_name, who, action, note, status)
    values (v_name, v_who, v_action, v_summary, v_status);
  end if;
end;
$$;

alter table public.people enable row level security;
alter table public.facilities enable row level security;
alter table public.call_logs enable row level security;

drop policy if exists people_family on public.people;
create policy people_family on public.people
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists facilities_family on public.facilities;
create policy facilities_family on public.facilities
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists call_logs_family on public.call_logs;
create policy call_logs_family on public.call_logs
  for all to authenticated
  using (true)
  with check (true);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.people, public.facilities, public.call_logs to authenticated;

revoke all on function public.claim_facility(text, text) from public, anon;
revoke all on function public.release_facility(text, text) from public, anon;
revoke all on function public.add_person(text) from public, anon;
revoke all on function public.save_facility(jsonb) from public, anon;
grant execute on function public.claim_facility(text, text) to authenticated;
grant execute on function public.release_facility(text, text) to authenticated;
grant execute on function public.add_person(text) to authenticated;
grant execute on function public.save_facility(jsonb) to authenticated;

alter table public.facilities replica identity full;
alter table public.call_logs replica identity full;
alter table public.people replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'facilities'
  ) then
    execute 'alter publication supabase_realtime add table public.facilities';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_logs'
  ) then
    execute 'alter publication supabase_realtime add table public.call_logs';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'people'
  ) then
    execute 'alter publication supabase_realtime add table public.people';
  end if;
end $$;
