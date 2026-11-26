-- Blood on the Clocktower stats: Supabase database setup.
--
-- Run this whole file once in the Supabase dashboard: SQL Editor -> New query
-- -> paste -> Run. It is safe to run again after pulling a newer version.
--
-- Then set the storyteller passcode in a separate query (pick your own; do not
-- commit it, this repository is public):
--
--   select private.set_passcode('your passcode here');
--
-- Security model: anyone can read games (the site is public). Nobody can write
-- to the table directly; every change goes through a function below that
-- checks the passcode against a bcrypt hash stored in the unexposed `private`
-- schema.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- private

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create table if not exists private.settings (
  key text primary key,
  value text not null
);
revoke all on private.settings from public;
revoke all on private.settings from anon, authenticated;

create or replace function private.set_passcode(p_passcode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(coalesce(p_passcode, '')) < 4 then
    raise exception 'Passcode must be at least 4 characters.';
  end if;
  insert into private.settings (key, value)
  values ('passcode_hash', extensions.crypt(p_passcode, extensions.gen_salt('bf', 10)))
  on conflict (key) do update set value = excluded.value;
end;
$$;

create or replace function private.passcode_ok(p_passcode text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.settings
    where key = 'passcode_hash'
      and value = extensions.crypt(coalesce(p_passcode, ''), value)
  );
$$;

create or replace function private.require_passcode(p_passcode text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.passcode_ok(p_passcode) then
    -- PostgREST turns SQLSTATE PTxyz into HTTP status xyz.
    raise sqlstate 'PT401' using message = 'Incorrect passcode.';
  end if;
end;
$$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema private from anon, authenticated;

-- ---------------------------------------------------------------- games

-- One row per game, same fields as the local SQLite `games` table. `seq` keeps
-- insertion order, which breaks ties between games on the same date.
create table if not exists public.games (
  seq bigint generated always as identity,
  id text primary key,
  source text not null default 'database',
  date text not null,
  outcome text not null,
  final_day text not null default '',
  storyteller text not null default '',
  player_count integer not null default 0,
  format text not null default '',
  script text not null default '',
  win_names jsonb not null default '[]'::jsonb,
  loss_names jsonb not null default '[]'::jsonb,
  roles jsonb not null default '{}'::jsonb,
  alignment_overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists games_seq_idx on public.games (seq);

alter table public.games enable row level security;
drop policy if exists "Games are public" on public.games;
create policy "Games are public" on public.games for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
revoke all on public.games from anon, authenticated;
grant select on public.games to anon, authenticated;

-- Validates an app-shaped game object ({ date, outcome, finalDay, storyteller,
-- playerCount, format, script, winNames, lossNames, roles, alignmentOverrides })
-- and returns it as a games row. Mirrors normalizeGame() in server.mjs.
create or replace function private.game_row(p_game jsonb, p_id text, p_source text, p_validate boolean)
returns public.games
language plpgsql
immutable
set search_path = ''
as $$
declare
  r public.games;
  v_count text := btrim(coalesce(p_game ->> 'playerCount', ''));
begin
  if jsonb_typeof(p_game) is distinct from 'object' then
    raise sqlstate 'PT400' using message = 'Invalid game payload.';
  end if;

  r.id := p_id;
  r.source := p_source;
  r.date := btrim(coalesce(p_game ->> 'date', ''));
  r.outcome := btrim(coalesce(p_game ->> 'outcome', ''));
  r.final_day := btrim(coalesce(p_game ->> 'finalDay', ''));
  r.storyteller := btrim(coalesce(p_game ->> 'storyteller', ''));
  r.format := btrim(coalesce(p_game ->> 'format', ''));
  r.script := btrim(coalesce(p_game ->> 'script', ''));
  r.roles := case when jsonb_typeof(p_game -> 'roles') = 'object' then p_game -> 'roles' else '{}'::jsonb end;
  r.alignment_overrides := case
    when jsonb_typeof(p_game -> 'alignmentOverrides') = 'object' then p_game -> 'alignmentOverrides'
    else '{}'::jsonb
  end;
  r.win_names := coalesce((
    select jsonb_agg(btrim(name) order by position)
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_game -> 'winNames') = 'array' then p_game -> 'winNames' else '[]'::jsonb end
    ) with ordinality as names(name, position)
    where btrim(name) <> ''
  ), '[]'::jsonb);
  r.loss_names := coalesce((
    select jsonb_agg(btrim(name) order by position)
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_game -> 'lossNames') = 'array' then p_game -> 'lossNames' else '[]'::jsonb end
    ) with ordinality as names(name, position)
    where btrim(name) <> ''
  ), '[]'::jsonb);
  r.player_count := case
    when v_count ~ '^-?[0-9]+(\.[0-9]+)?$' then round(v_count::numeric)::integer
    else (select count(*) from jsonb_object_keys(r.roles))::integer
  end;

  if p_validate and (r.date = '' or r.outcome not in ('Good', 'Evil')) then
    raise sqlstate 'PT400' using message = 'A date and a Good or Evil outcome are required.';
  end if;
  return r;
end;
$$;
revoke all on function private.game_row(jsonb, text, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- API (called by the site)

create or replace function public.check_passcode(p_passcode text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.passcode_ok(p_passcode);
$$;

create or replace function public.add_game(p_passcode text, p_game jsonb)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.games;
begin
  perform private.require_passcode(p_passcode);
  r := private.game_row(p_game, 'game-' || gen_random_uuid()::text, 'database', true);
  insert into public.games (
    id, source, date, outcome, final_day, storyteller, player_count, format, script,
    win_names, loss_names, roles, alignment_overrides
  ) values (
    r.id, r.source, r.date, r.outcome, r.final_day, r.storyteller, r.player_count, r.format, r.script,
    r.win_names, r.loss_names, r.roles, r.alignment_overrides
  )
  returning * into r;
  return r;
end;
$$;

create or replace function public.update_game(p_passcode text, p_id text, p_game jsonb)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.games;
begin
  perform private.require_passcode(p_passcode);
  r := private.game_row(p_game, p_id, 'database', true);
  update public.games set
    date = r.date,
    outcome = r.outcome,
    final_day = r.final_day,
    storyteller = r.storyteller,
    player_count = r.player_count,
    format = r.format,
    script = r.script,
    win_names = r.win_names,
    loss_names = r.loss_names,
    roles = r.roles,
    alignment_overrides = r.alignment_overrides,
    updated_at = now()
  where id = p_id
  returning * into r;
  if not found then
    raise sqlstate 'PT404' using message = 'Game not found.';
  end if;
  return r;
end;
$$;

create or replace function public.delete_game(p_passcode text, p_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_passcode(p_passcode);
  delete from public.games where id = p_id;
  if not found then
    raise sqlstate 'PT404' using message = 'Game not found.';
  end if;
  return true;
end;
$$;

-- Replaces the Games Sheet rows (source 'games-sheet') with the CSV's games
-- when the CSV changed. Games entered on the site are kept. Called by
-- sync-supabase.mjs (the Pages workflow runs it on every push to main).
create or replace function public.sync_games_sheet(p_passcode text, p_hash text, p_games jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text;
  v_count integer;
begin
  perform private.require_passcode(p_passcode);
  if coalesce(p_hash, '') = '' or jsonb_typeof(p_games) is distinct from 'array' then
    raise sqlstate 'PT400' using message = 'A hash and a games array are required.';
  end if;

  select value into v_previous from private.settings where key = 'games_sheet_hash';
  if v_previous = p_hash then
    return jsonb_build_object(
      'status', 'unchanged',
      'games', (select count(*) from public.games where source = 'games-sheet')
    );
  end if;

  delete from public.games where source = 'games-sheet';
  insert into public.games (
    id, source, date, outcome, final_day, storyteller, player_count, format, script,
    win_names, loss_names, roles, alignment_overrides
  )
  select r.id, r.source, r.date, r.outcome, r.final_day, r.storyteller, r.player_count, r.format, r.script,
    r.win_names, r.loss_names, r.roles, r.alignment_overrides
  from jsonb_array_elements(p_games) with ordinality as sheet(game, position)
  cross join lateral private.game_row(sheet.game, sheet.game ->> 'id', 'games-sheet', false) as r
  order by sheet.position;
  get diagnostics v_count = row_count;

  insert into private.settings (key, value) values ('games_sheet_hash', p_hash)
  on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('status', 'synced', 'games', v_count);
end;
$$;

revoke all on function public.check_passcode(text) from public;
revoke all on function public.add_game(text, jsonb) from public;
revoke all on function public.update_game(text, text, jsonb) from public;
revoke all on function public.delete_game(text, text) from public;
revoke all on function public.sync_games_sheet(text, text, jsonb) from public;
grant execute on function public.check_passcode(text) to anon, authenticated;
grant execute on function public.add_game(text, jsonb) to anon, authenticated;
grant execute on function public.update_game(text, text, jsonb) to anon, authenticated;
grant execute on function public.delete_game(text, text) to anon, authenticated;
grant execute on function public.sync_games_sheet(text, text, jsonb) to anon, authenticated;
