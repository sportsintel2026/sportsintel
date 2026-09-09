-- Proposed production migration. Apply before deploying the NFL Props tracker code.
-- Immutable first-customer-facing snapshot; only automatic final-stat settlement may update.

create table public.nfl_prop_customer_picks (
  id bigint generated always as identity primary key,
  event_id text not null check (btrim(event_id) <> ''),
  event_date date not null,
  commence_at timestamptz not null,
  prediction_at timestamptz not null,
  season integer not null check (season between 2000 and 2100),
  season_week integer check (season_week between 1 and 25),
  player_id text not null check (btrim(player_id) <> ''),
  player_name text not null check (btrim(player_name) <> ''),
  team_id text not null check (btrim(team_id) <> ''),
  team_name text not null check (btrim(team_name) <> ''),
  opponent_name text not null check (btrim(opponent_name) <> ''),
  matchup text not null check (btrim(matchup) <> ''),
  category text not null check (category in (
    'pass_yds', 'pass_tds', 'rush_yds', 'rec_yds', 'receptions', 'anytime_td'
  )),
  side text not null check (side in ('OVER', 'UNDER', 'ANYTIME_TD')),
  line double precision,
  sportsbook text not null check (btrim(sportsbook) <> ''),
  odds integer not null check (abs(odds) >= 100),
  model_projection double precision,
  model_edge double precision,
  model_version text not null check (btrim(model_version) <> ''),
  final_stat double precision,
  result text not null default 'PENDING' check (result in ('PENDING', 'WIN', 'LOSS', 'PUSH', 'VOID')),
  unit_pnl double precision,
  result_source text,
  graded_at timestamptz,
  created_at timestamptz not null default now(),

  constraint nfl_prop_customer_prediction_time_ck check (prediction_at < commence_at),
  constraint nfl_prop_customer_market_shape_ck check (
    (
      category = 'anytime_td'
      and side = 'ANYTIME_TD'
      and line is null
      and model_projection is null
      and model_edge is null
    )
    or
    (
      category <> 'anytime_td'
      and side in ('OVER', 'UNDER')
      and line is not null
      and model_projection is not null
      and model_edge is not null and model_edge > 0
    )
  ),
  constraint nfl_prop_customer_result_group_ck check (
    (
      result = 'PENDING'
      and final_stat is null
      and unit_pnl is null
      and result_source is null
      and graded_at is null
    )
    or
    (
      result = 'VOID'
      and final_stat is null
      and unit_pnl = 0
      and result_source is not null
      and graded_at is not null
    )
    or
    (
      result in ('WIN', 'LOSS', 'PUSH')
      and final_stat is not null
      and unit_pnl is not null
      and result_source is not null
      and graded_at is not null
    )
  ),
  unique (event_id, player_id, category)
);

create index idx_nfl_prop_customer_filters
  on public.nfl_prop_customer_picks (season, season_week, category, event_date desc);

create index idx_nfl_prop_customer_pending
  on public.nfl_prop_customer_picks (event_date, event_id)
  where result = 'PENDING';

alter table public.nfl_prop_customer_picks enable row level security;

revoke all privileges
  on table public.nfl_prop_customer_picks
  from public, anon, authenticated, service_role;

revoke all privileges
  on sequence public.nfl_prop_customer_picks_id_seq
  from public, anon, authenticated, service_role;

grant select, insert
  on table public.nfl_prop_customer_picks
  to service_role;

grant update (final_stat, result, unit_pnl, result_source, graded_at)
  on table public.nfl_prop_customer_picks
  to service_role;

grant usage, select
  on sequence public.nfl_prop_customer_picks_id_seq
  to service_role;

create function public.guard_nfl_prop_customer_pick_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  mutable_columns constant text[] := array[
    'final_stat', 'result', 'unit_pnl', 'result_source', 'graded_at'
  ];
  expected_win_pnl double precision;
begin
  if (to_jsonb(new) - mutable_columns)
       is distinct from
     (to_jsonb(old) - mutable_columns) then
    raise exception 'NFL customer prop prediction-time fields are immutable';
  end if;

  if old.result <> 'PENDING'
     and row(new.final_stat, new.result, new.unit_pnl, new.result_source, new.graded_at)
       is distinct from
         row(old.final_stat, old.result, old.unit_pnl, old.result_source, old.graded_at) then
    raise exception 'Settled NFL customer prop result is immutable';
  end if;

  if new.result = 'WIN' then
    expected_win_pnl := case when old.odds > 0 then old.odds / 100.0 else 100.0 / abs(old.odds) end;
    if new.unit_pnl is null or abs(new.unit_pnl - expected_win_pnl) > 0.000001 then
      raise exception 'NFL customer prop win P&L must use the immutable published odds';
    end if;
  elsif new.result = 'LOSS' and new.unit_pnl is distinct from -1.0 then
    raise exception 'NFL customer prop loss P&L must be -1 unit risked';
  elsif new.result in ('PUSH', 'VOID') and new.unit_pnl is distinct from 0.0 then
    raise exception 'NFL customer prop push/void P&L must be 0';
  end if;
  return new;
end;
$$;

create trigger guard_nfl_prop_customer_pick_update
before update on public.nfl_prop_customer_picks
for each row
execute function public.guard_nfl_prop_customer_pick_update();

revoke all privileges
  on function public.guard_nfl_prop_customer_pick_update()
  from public, anon, authenticated;

grant execute
  on function public.guard_nfl_prop_customer_pick_update()
  to service_role;
