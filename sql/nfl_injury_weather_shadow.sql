-- PROPOSED ONLY — do not apply without owner approval.
-- Service-role-only immutable NFL injury/weather context and control/challenger ledger.

create table public.nfl_injury_weather_context_snapshots (
  id bigint generated always as identity primary key,
  event_id text not null check (btrim(event_id) <> ''),
  game_date date not null,
  commence_at timestamptz not null,
  prediction_at timestamptz not null,
  market_captured_at timestamptz not null,
  espn_game_id text,
  home_team_id text,
  away_team_id text,
  home_team text not null check (btrim(home_team) <> ''),
  away_team text not null check (btrim(away_team) <> ''),
  venue_id text,
  venue_name text,
  indoor boolean,
  market_snapshot jsonb not null check (jsonb_typeof(market_snapshot) = 'object'),
  base_model_context jsonb not null check (jsonb_typeof(base_model_context) = 'object'),
  home_availability jsonb not null check (jsonb_typeof(home_availability) = 'array'),
  away_availability jsonb not null check (jsonb_typeof(away_availability) = 'array'),
  availability_collection jsonb not null check (jsonb_typeof(availability_collection) = 'object'),
  weather_context jsonb check (weather_context is null or jsonb_typeof(weather_context) = 'object'),
  adjustment_context jsonb not null check (jsonb_typeof(adjustment_context) = 'object'),
  context_version text not null
    check (context_version = 'nfl-injury-weather-context-v1-2026-09-08'),
  model_version text not null
    check (model_version = 'nfl-game-control-30-70-v1-2026-09-08'),
  experiment_version text not null
    check (experiment_version = 'nfl-injury-weather-shadow-v1-2026-09-08'),
  input_fingerprint text not null
    check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint nfl_injury_weather_context_pregame_ck check (
    prediction_at < commence_at and market_captured_at < commence_at
  ),
  unique (event_id, prediction_at, context_version)
);

create index nfl_injury_weather_context_game_idx
  on public.nfl_injury_weather_context_snapshots (game_date, event_id);

alter table public.nfl_injury_weather_context_snapshots enable row level security;

revoke all privileges
  on table public.nfl_injury_weather_context_snapshots
  from public, anon, authenticated, service_role;
revoke all privileges
  on sequence public.nfl_injury_weather_context_snapshots_id_seq
  from public, anon, authenticated, service_role;

grant select, insert
  on table public.nfl_injury_weather_context_snapshots
  to service_role;
grant usage, select
  on sequence public.nfl_injury_weather_context_snapshots_id_seq
  to service_role;

create function public.prevent_nfl_injury_weather_context_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'NFL injury/weather prediction-time context is immutable';
end;
$$;

create trigger nfl_injury_weather_context_immutable
before update or delete on public.nfl_injury_weather_context_snapshots
for each row
execute function public.prevent_nfl_injury_weather_context_mutation();

revoke all privileges
  on function public.prevent_nfl_injury_weather_context_mutation()
  from public, anon, authenticated;
grant execute
  on function public.prevent_nfl_injury_weather_context_mutation()
  to service_role;

create table public.nfl_injury_weather_shadow_predictions (
  id bigint generated always as identity primary key,
  context_snapshot_id bigint not null
    references public.nfl_injury_weather_context_snapshots(id),
  event_id text not null check (btrim(event_id) <> ''),
  game_date date not null,
  commence_at timestamptz not null,
  prediction_at timestamptz not null,
  market text not null
    check (market in ('moneyline', 'spread', 'total', 'home_team_points', 'away_team_points')),
  reference_side text not null check (reference_side in ('home', 'away', 'over')),
  market_line double precision,
  entry_price integer check (entry_price is null or abs(entry_price) >= 100),
  market_fair_prob double precision check (market_fair_prob is null or market_fair_prob between 0 and 1),
  control_projection double precision,
  challenger_projection double precision,
  control_raw_prob double precision check (control_raw_prob is null or control_raw_prob between 0 and 1),
  challenger_raw_prob double precision check (challenger_raw_prob is null or challenger_raw_prob between 0 and 1),
  control_published_prob double precision check (control_published_prob is null or control_published_prob between 0 and 1),
  challenger_published_prob double precision check (challenger_published_prob is null or challenger_published_prob between 0 and 1),
  control_signed_edge double precision check (control_signed_edge is null or control_signed_edge between -1 and 1),
  challenger_signed_edge double precision check (challenger_signed_edge is null or challenger_signed_edge between -1 and 1),
  control_output jsonb check (control_output is null or jsonb_typeof(control_output) = 'object'),
  challenger_output jsonb check (challenger_output is null or jsonb_typeof(challenger_output) = 'object'),
  adjustment_applied boolean not null,
  adjustment_status text not null check (btrim(adjustment_status) <> ''),
  model_version text not null
    check (model_version = 'nfl-game-control-30-70-v1-2026-09-08'),
  experiment_version text not null
    check (experiment_version = 'nfl-injury-weather-shadow-v1-2026-09-08'),

  closing_line double precision,
  closing_price integer check (closing_price is null or abs(closing_price) >= 100),
  closing_market_fair_prob double precision
    check (closing_market_fair_prob is null or closing_market_fair_prob between 0 and 1),
  closing_captured_at timestamptz,
  pinnacle_closing_line double precision,
  pinnacle_closing_price integer
    check (pinnacle_closing_price is null or abs(pinnacle_closing_price) >= 100),
  pinnacle_closing_market_fair_prob double precision
    check (pinnacle_closing_market_fair_prob is null or pinnacle_closing_market_fair_prob between 0 and 1),
  pinnacle_closing_captured_at timestamptz,

  result_status text not null default 'pending'
    check (result_status in ('pending', 'win', 'loss', 'push', 'void')),
  home_score integer check (home_score is null or home_score >= 0),
  away_score integer check (away_score is null or away_score >= 0),
  observed_value double precision,
  result_source text,
  graded_at timestamptz,
  created_at timestamptz not null default now(),

  constraint nfl_injury_weather_reference_side_ck check (
    (market in ('moneyline', 'spread') and reference_side = 'home')
    or (market = 'total' and reference_side = 'over')
    or (market = 'home_team_points' and reference_side = 'home')
    or (market = 'away_team_points' and reference_side = 'away')
  ),
  constraint nfl_injury_weather_result_group_ck check (
    (
      result_status = 'pending'
      and home_score is null and away_score is null
      and observed_value is null and result_source is null and graded_at is null
    )
    or
    (
      result_status in ('win', 'loss', 'push')
      and home_score is not null and away_score is not null
      and observed_value is not null and result_source is not null and graded_at is not null
    )
    or
    (
      result_status = 'void'
      and result_source is not null and graded_at is not null
    )
  ),
  constraint nfl_injury_weather_closing_time_ck check (
    (closing_captured_at is null or closing_captured_at <= commence_at)
    and (pinnacle_closing_captured_at is null or pinnacle_closing_captured_at <= commence_at)
  ),
  unique (context_snapshot_id, market)
);

create index nfl_injury_weather_shadow_game_idx
  on public.nfl_injury_weather_shadow_predictions (game_date, event_id);
create index nfl_injury_weather_shadow_pending_idx
  on public.nfl_injury_weather_shadow_predictions (game_date, event_id)
  where result_status = 'pending';

alter table public.nfl_injury_weather_shadow_predictions enable row level security;

revoke all privileges
  on table public.nfl_injury_weather_shadow_predictions
  from public, anon, authenticated, service_role;
revoke all privileges
  on sequence public.nfl_injury_weather_shadow_predictions_id_seq
  from public, anon, authenticated, service_role;

grant select, insert
  on table public.nfl_injury_weather_shadow_predictions
  to service_role;
grant update (
  closing_line, closing_price, closing_market_fair_prob, closing_captured_at,
  pinnacle_closing_line, pinnacle_closing_price, pinnacle_closing_market_fair_prob,
  pinnacle_closing_captured_at, result_status, home_score, away_score,
  observed_value, result_source, graded_at
)
  on table public.nfl_injury_weather_shadow_predictions
  to service_role;
grant usage, select
  on sequence public.nfl_injury_weather_shadow_predictions_id_seq
  to service_role;

create function public.guard_nfl_injury_weather_shadow_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  mutable_columns constant text[] := array[
    'closing_line', 'closing_price', 'closing_market_fair_prob', 'closing_captured_at',
    'pinnacle_closing_line', 'pinnacle_closing_price',
    'pinnacle_closing_market_fair_prob', 'pinnacle_closing_captured_at',
    'result_status', 'home_score', 'away_score', 'observed_value', 'result_source', 'graded_at'
  ];
begin
  if (to_jsonb(new) - mutable_columns)
       is distinct from
     (to_jsonb(old) - mutable_columns) then
    raise exception 'NFL injury/weather prediction-time comparison is immutable';
  end if;

  if new.closing_captured_at is not null
     and old.closing_captured_at is not null
     and new.closing_captured_at < old.closing_captured_at then
    raise exception 'Older NFL closing snapshot cannot replace a newer snapshot';
  end if;
  if new.pinnacle_closing_captured_at is not null
     and old.pinnacle_closing_captured_at is not null
     and new.pinnacle_closing_captured_at < old.pinnacle_closing_captured_at then
    raise exception 'Older NFL Pinnacle snapshot cannot replace a newer snapshot';
  end if;
  if old.result_status <> 'pending'
     and row(new.result_status, new.home_score, new.away_score, new.observed_value, new.result_source, new.graded_at)
       is distinct from
         row(old.result_status, old.home_score, old.away_score, old.observed_value, old.result_source, old.graded_at) then
    raise exception 'Settled NFL injury/weather result is immutable';
  end if;
  return new;
end;
$$;

create trigger nfl_injury_weather_shadow_update_guard
before update on public.nfl_injury_weather_shadow_predictions
for each row
execute function public.guard_nfl_injury_weather_shadow_update();

create function public.prevent_nfl_injury_weather_shadow_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'NFL injury/weather shadow rows cannot be deleted';
end;
$$;

create trigger nfl_injury_weather_shadow_delete_guard
before delete on public.nfl_injury_weather_shadow_predictions
for each row
execute function public.prevent_nfl_injury_weather_shadow_delete();

revoke all privileges
  on function public.guard_nfl_injury_weather_shadow_update()
  from public, anon, authenticated;
revoke all privileges
  on function public.prevent_nfl_injury_weather_shadow_delete()
  from public, anon, authenticated;
grant execute
  on function public.guard_nfl_injury_weather_shadow_update()
  to service_role;
grant execute
  on function public.prevent_nfl_injury_weather_shadow_delete()
  to service_role;
