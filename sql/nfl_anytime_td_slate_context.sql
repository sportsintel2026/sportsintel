-- Durable, service-role-only current-slate context for cold-start NFL Anytime TD ranking.
-- The normal runNFLSlate flow refreshes each event row; startup reads only fresh future rows.

create table public.nfl_anytime_td_slate_context (
  event_id text primary key,
  game_date date not null,
  commence_at timestamptz not null,
  captured_at timestamptz not null,
  source_season integer not null check (source_season between 2000 and 2100),
  context_version text not null
    check (context_version = 'nfl-anytime-td-slate-context-v1-2026-09-08'),
  total_line double precision not null check (total_line > 0),
  home_spread_line double precision not null,
  home_implied_points double precision not null check (home_implied_points >= 0),
  away_implied_points double precision not null check (away_implied_points >= 0),
  home_team_id text not null check (btrim(home_team_id) <> ''),
  home_team text not null check (btrim(home_team) <> ''),
  home_projected_points double precision not null check (home_projected_points >= 0),
  home_offense_ppg double precision,
  home_opponent_defense_pa_per_game double precision,
  away_team_id text not null check (btrim(away_team_id) <> ''),
  away_team text not null check (btrim(away_team) <> ''),
  away_projected_points double precision not null check (away_projected_points >= 0),
  away_offense_ppg double precision,
  away_opponent_defense_pa_per_game double precision,
  constraint nfl_atd_context_implied_points_ck check (
    abs(home_implied_points - ((total_line - home_spread_line) / 2.0)) < 0.000001
    and abs(away_implied_points - ((total_line + home_spread_line) / 2.0)) < 0.000001
  ),
  constraint nfl_atd_context_pregame_ck check (captured_at < commence_at)
);

create index idx_nfl_atd_context_commence
  on public.nfl_anytime_td_slate_context (commence_at);

alter table public.nfl_anytime_td_slate_context enable row level security;

revoke all privileges
  on table public.nfl_anytime_td_slate_context
  from public, anon, authenticated, service_role;

grant select, insert, update
  on table public.nfl_anytime_td_slate_context
  to service_role;

create function public.guard_nfl_anytime_td_slate_context_freshness()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.captured_at < old.captured_at then
    raise exception 'Older NFL Anytime TD slate context cannot replace a newer snapshot';
  end if;
  return new;
end;
$$;

create trigger guard_nfl_anytime_td_slate_context_freshness
before update on public.nfl_anytime_td_slate_context
for each row
execute function public.guard_nfl_anytime_td_slate_context_freshness();

revoke all privileges
  on function public.guard_nfl_anytime_td_slate_context_freshness()
  from public, anon, authenticated;

grant execute
  on function public.guard_nfl_anytime_td_slate_context_freshness()
  to service_role;
