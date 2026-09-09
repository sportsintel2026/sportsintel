-- PROPOSED ONLY — do not apply without owner approval.
-- Immutable first-snapshot ledger for the descriptive NFL Anytime TD v3 shortlist.
-- These rows are not picks and intentionally stay outside model_predictions.

create table public.nfl_anytime_td_rankings_shadow (
  id bigint generated always as identity primary key,
  event_id text not null,
  event_date date not null,
  commence_at timestamptz not null,
  prediction_at timestamptz not null,
  quote_captured_at timestamptz not null,
  player_id text not null,
  player_name text not null check (btrim(player_name) <> ''),
  team_id text not null,
  team_name text not null check (btrim(team_name) <> ''),
  opponent_name text not null check (btrim(opponent_name) <> ''),
  player_position text not null check (player_position in ('QB', 'RB', 'WR', 'TE')),
  home_away text not null check (home_away in ('home', 'away')),
  matchup text not null check (btrim(matchup) <> ''),
  source_season integer not null check (source_season between 2000 and 2100),

  games_played integer not null check (games_played > 0),
  carries integer not null check (carries >= 0),
  targets integer not null check (targets >= 0),
  rushing_tds integer not null check (rushing_tds >= 0),
  receiving_tds integer not null check (receiving_tds >= 0),
  opportunity_per_game double precision not null check (opportunity_per_game >= 0),
  scoring_tds_per_game double precision not null check (scoring_tds_per_game >= 0),
  team_implied_points double precision not null check (team_implied_points >= 0),
  team_projected_points double precision not null check (team_projected_points >= 0),
  team_offense_ppg double precision,
  opponent_defense_pa_per_game double precision,
  availability jsonb,

  score_components jsonb not null check (jsonb_typeof(score_components) = 'object'),
  candidate_score double precision not null check (candidate_score between 0 and 100),
  game_rank integer not null check (game_rank > 0),
  team_rank integer not null check (team_rank > 0),
  market_consensus_implied double precision not null check (market_consensus_implied > 0 and market_consensus_implied < 1),
  market_quote_count integer not null check (market_quote_count > 0),
  market_rank integer not null check (market_rank > 0),
  market_rank_disagreement integer not null,
  selected_for_display boolean not null,
  best_book text not null check (btrim(best_book) <> ''),
  best_price integer not null check (abs(best_price) >= 100),
  all_book_quotes jsonb not null
    check (jsonb_typeof(all_book_quotes) = 'array' and jsonb_array_length(all_book_quotes) > 0),
  ranking_version text not null check (ranking_version = 'nfl-anytime-td-role-value-v3-2026-09-08'),

  result_status text not null default 'pending'
    check (result_status in ('pending', 'scored', 'not_scored', 'void')),
  result_source text,
  rushing_tds_result integer,
  receiving_tds_result integer,
  graded_at timestamptz,
  created_at timestamptz not null default now(),

  unique (event_id, player_id, ranking_version),
  constraint nfl_atd_result_group_ck check (
    (
      result_status = 'pending'
      and result_source is null
      and rushing_tds_result is null
      and receiving_tds_result is null
      and graded_at is null
    )
    or
    (
      result_status = 'void'
      and result_source is not null
      and rushing_tds_result is null
      and receiving_tds_result is null
      and graded_at is not null
    )
    or
    (
      result_status in ('scored', 'not_scored')
      and result_source is not null
      and rushing_tds_result is not null and rushing_tds_result >= 0
      and receiving_tds_result is not null and receiving_tds_result >= 0
      and graded_at is not null
      and (result_status = 'scored') = ((rushing_tds_result + receiving_tds_result) > 0)
    )
  )
);

create index idx_nfl_atd_rankings_date
  on public.nfl_anytime_td_rankings_shadow (event_date, event_id);

create index idx_nfl_atd_rankings_pending
  on public.nfl_anytime_td_rankings_shadow (event_date, event_id)
  where result_status = 'pending';

alter table public.nfl_anytime_td_rankings_shadow enable row level security;

revoke all privileges
  on table public.nfl_anytime_td_rankings_shadow
  from public, anon, authenticated, service_role;

revoke all privileges
  on sequence public.nfl_anytime_td_rankings_shadow_id_seq
  from public, anon, authenticated, service_role;

grant select, insert
  on table public.nfl_anytime_td_rankings_shadow
  to service_role;

grant update (result_status, result_source, rushing_tds_result, receiving_tds_result, graded_at)
  on table public.nfl_anytime_td_rankings_shadow
  to service_role;

grant usage, select
  on sequence public.nfl_anytime_td_rankings_shadow_id_seq
  to service_role;

create function public.guard_nfl_anytime_td_rankings_shadow_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  mutable_columns constant text[] := array[
    'result_status', 'result_source', 'rushing_tds_result', 'receiving_tds_result', 'graded_at'
  ];
begin
  if (to_jsonb(new) - mutable_columns)
       is distinct from
     (to_jsonb(old) - mutable_columns) then
    raise exception 'NFL Anytime TD prediction-time ranking fields are immutable';
  end if;

  if old.result_status <> 'pending'
     and row(new.result_status, new.result_source, new.rushing_tds_result, new.receiving_tds_result, new.graded_at)
       is distinct from
         row(old.result_status, old.result_source, old.rushing_tds_result, old.receiving_tds_result, old.graded_at) then
    raise exception 'Settled NFL Anytime TD result is immutable';
  end if;
  return new;
end;
$$;

create trigger guard_nfl_anytime_td_rankings_shadow_update
before update on public.nfl_anytime_td_rankings_shadow
for each row
execute function public.guard_nfl_anytime_td_rankings_shadow_update();

revoke all privileges
  on function public.guard_nfl_anytime_td_rankings_shadow_update()
  from public, anon, authenticated;

grant execute
  on function public.guard_nfl_anytime_td_rankings_shadow_update()
  to service_role;
