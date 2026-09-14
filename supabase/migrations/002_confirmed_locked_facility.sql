-- Research-backed flag: does this home actually have a locked / secure memory care unit?
-- Run in the Supabase SQL editor after 001_init.sql.

alter table public.facilities
  add column if not exists confirmed_locked_facility text not null default '';

-- Confirmed locked / secure memory care units (Sep 2026 research).
update public.facilities set confirmed_locked_facility = 'yes'
where name in (
  'Ashley Gardens of Mount Vernon',
  'Cordata Court',
  'Creekside Continuing Care Community',
  'Highgate Senior Living',
  'HomePlace at Burlington by Cogir',
  'Silverado Bellingham',
  'Spring Creek Retirement & AL',
  'The Bellingham At Orchard',
  'Where the Heart Is by Cogir'
);

-- All other listed homes: not a confirmed locked memory care facility.
update public.facilities set confirmed_locked_facility = 'no'
where coalesce(confirmed_locked_facility, '') = '';
