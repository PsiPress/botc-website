-- Blood on the Clocktower stats: Supabase database setup.
--
-- Run this whole file in the Supabase dashboard: SQL Editor -> New query ->
-- paste -> Run. It is safe to run again after pulling a newer version.
-- Then run supabase/seed.sql the same way to load the club's existing data.
--
-- Security model: anyone can read everything (the site is public). Only
-- editors can change anything. An editor is a Supabase Auth user listed in
-- private.editors:
--
--   1. Authentication -> Users -> Add user (email + password, auto-confirm).
--   2. SQL Editor: select private.add_editor('their@email.address');
--
-- Turn off public sign-ups too (Authentication -> Sign In / Providers ->
-- "Allow new users to sign up"). Even with sign-ups on, a stranger's account
-- could not edit, because it is not in private.editors.

-- ---------------------------------------------------------------- editors

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create table if not exists private.editors (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
revoke all on private.editors from public;
revoke all on private.editors from anon, authenticated;

create or replace function private.add_editor(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_id is null then
    raise exception 'No user with email %. Add it under Authentication -> Users first.', p_email;
  end if;
  insert into private.editors (user_id) values (v_id) on conflict do nothing;
  return 'Editor added: ' || p_email;
end;
$$;

create or replace function private.remove_editor(p_email text)
returns text
language sql
security definer
set search_path = ''
as $$
  delete from private.editors where user_id in (select id from auth.users where lower(email) = lower(btrim(p_email)));
  select 'Editor removed: ' || p_email;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema private from anon, authenticated;

-- True when the signed-in user is an editor. The site calls it to decide
-- whether to show editing controls; the policies below use it to allow writes.
create or replace function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.editors where user_id = (select auth.uid()));
$$;
revoke all on function public.is_editor() from public;
grant execute on function public.is_editor() to anon, authenticated;

-- ---------------------------------------------------------------- tables

-- One row per game. `seq` keeps insertion order, which breaks ties between
-- games on the same date. `date` uses the sheet's m/d/yy text format.
create table if not exists public.games (
  seq bigint generated always as identity,
  id text primary key default ('game-' || gen_random_uuid()::text),
  source text not null default 'database',
  date text not null check (btrim(date) <> ''),
  outcome text not null check (outcome in ('Good', 'Evil')),
  final_day text not null default '',
  storyteller text not null default '',
  player_count integer not null default 0,
  format text not null default '',
  script text not null default '',
  win_names jsonb not null default '[]'::jsonb check (jsonb_typeof(win_names) = 'array'),
  loss_names jsonb not null default '[]'::jsonb check (jsonb_typeof(loss_names) = 'array'),
  roles jsonb not null default '{}'::jsonb check (jsonb_typeof(roles) = 'object'),
  alignment_overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(alignment_overrides) = 'object'),
  mango_nectar jsonb not null default '[]'::jsonb check (jsonb_typeof(mango_nectar) = 'array'),
  mushroom_elixir jsonb not null default '[]'::jsonb check (jsonb_typeof(mushroom_elixir) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists games_seq_idx on public.games (seq);

-- One row per person. `name` is the name used in games (the Games Sheet
-- column header) and never changes; `display_name` is what profiles show.
-- `slot` is the spreadsheet column order, which the rating model uses.
create table if not exists public.players (
  name text primary key check (btrim(name) <> ''),
  slot integer,
  display_name text not null default '',
  core boolean not null default false,
  title text not null default '',
  major text not null default '',
  status text not null default '',
  quote text not null default '',
  photo_path text not null default '',
  overall_skill text not null default '',
  good_skill text not null default '',
  evil_skill text not null default '',
  game_impact text not null default '',
  social_trust text not null default '',
  strengths text not null default '',
  weaknesses text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists players_name_key on public.players (lower(replace(name, ' ', '')));

-- New players without a slot go after the last column, like adding a column.
create or replace function private.players_next_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.slot is null then
    select coalesce(max(slot), -1) + 1 into new.slot from public.players;
  end if;
  return new;
end;
$$;
revoke all on function private.players_next_slot() from public, anon, authenticated;

drop trigger if exists players_next_slot on public.players;
create trigger players_next_slot before insert on public.players
  for each row execute function private.players_next_slot();

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  starts_at timestamptz not null,
  location text not null default '',
  format text not null default '',
  script text not null default '',
  storyteller text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,
  caption text not null default '',
  taken_on date,
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Everyone reads, editors write.
do $$
declare
  t text;
begin
  foreach t in array array['games', 'players', 'events', 'photos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Public read" on public.%I', t);
    execute format('drop policy if exists "Editors insert" on public.%I', t);
    execute format('drop policy if exists "Editors update" on public.%I', t);
    execute format('drop policy if exists "Editors delete" on public.%I', t);
    execute format('create policy "Public read" on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy "Editors insert" on public.%I for insert to authenticated with check ((select public.is_editor()))', t);
    execute format('create policy "Editors update" on public.%I for update to authenticated using ((select public.is_editor())) with check ((select public.is_editor()))', t);
    execute format('create policy "Editors delete" on public.%I for delete to authenticated using ((select public.is_editor()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()', t);
  end loop;
end;
$$;
grant usage on schema public to anon, authenticated;

-- ---------------------------------------------------------------- photo storage

-- Public bucket: anyone can view files by URL; only editors can upload,
-- replace or delete. Holds gallery photos (gallery/...) and profile pictures
-- (players/...). The site shrinks images before upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Editors read media" on storage.objects;
drop policy if exists "Editors upload media" on storage.objects;
drop policy if exists "Editors update media" on storage.objects;
drop policy if exists "Editors delete media" on storage.objects;
-- Storage needs read access to delete or replace a file.
create policy "Editors read media" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (select public.is_editor()));
create policy "Editors upload media" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (select public.is_editor()));
create policy "Editors update media" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (select public.is_editor()))
  with check (bucket_id = 'media' and (select public.is_editor()));
create policy "Editors delete media" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (select public.is_editor()));
