-- PROPOSED ONLY — do not apply without owner approval.
-- Dedicated prospective full-slate MLB totals challenger ledger. Keeping these
-- rows out of model_predictions prevents shadow variants from contaminating the
-- published pick record, grading counts, calibration guard, or customer claims.

create table public.mlb_totals_calibration_shadow (
  id bigint generated always as identity primary key,
  game_id text not null,
  game_date date not null,
  prediction_at timestamptz not null,
  matchup text,

  variant_key text not null,
  model_family text not null check (model_family in ('logistic', 'discrete_negbin')),
  beta double precision not null check (beta >= 0 and beta <= 1),
  formula_version text not null,
  distribution_version text not null,
  logistic_sd double precision not null check (logistic_sd > 0),
  mean_to_median double precision not null,
  market_blend_enabled boolean not null,
  market_blend_weight double precision not null
    check (market_blend_weight >= 0 and market_blend_weight <= 1),

  market_total double precision not null check (market_total > 0),
  over_odds integer not null check (abs(over_odds) >= 100),
  under_odds integer not null check (abs(under_odds) >= 100),
  over_book text,
  under_book text,
  market_fair_over_prob double precision not null,
  market_fair_under_prob double precision not null,
  home_win_prob double precision,

  original_fatigue_adj double precision not null,
  candidate_fatigue_adj double precision not null,
  candidate_projected_total double precision not null,
  raw_over_prob double precision not null,
  raw_under_prob double precision not null,
  push_prob double precision not null default 0,
  decisive_raw_over_prob double precision not null,
  decisive_raw_under_prob double precision not null,
  published_over_prob double precision not null,
  published_under_prob double precision not null,

  base_runs double precision,
  pitcher_adj double precision,
  ace_adj double precision,
  park_adj double precision,
  weather_adj double precision,
  bullpen_adj double precision,
  ou_adj double precision,
  ump_adj double precision,
  defense_adj double precision,

  discrete_mu_home double precision,
  discrete_mu_away double precision,
  discrete_phi double precision,

  closing_total double precision,
  closing_over_odds integer,
  closing_under_odds integer,
  closing_over_book text,
  closing_under_book text,
  closing_captured_at timestamptz,
  pinnacle_closing_total double precision,
  pinnacle_over_odds integer,
  pinnacle_under_odds integer,
  pinnacle_fair_over_prob double precision,
  pinnacle_captured_at timestamptz,

  result_status text not null default 'pending'
    check (result_status in ('pending', 'over', 'under', 'push', 'void')),
  result_source text check (result_source in ('closing_lines_final_score', 'model_predictions_total_shadow')),
  final_away_runs integer,
  final_home_runs integer,
  actual_total_runs integer,
  graded_at timestamptz,
  created_at timestamptz not null default now(),

  unique (game_id, game_date, variant_key),
  check (raw_over_prob >= 0 and raw_over_prob <= 1),
  check (raw_under_prob >= 0 and raw_under_prob <= 1),
  check (push_prob >= 0 and push_prob <= 1),
  check (decisive_raw_over_prob >= 0 and decisive_raw_over_prob <= 1),
  check (decisive_raw_under_prob >= 0 and decisive_raw_under_prob <= 1),
  check (published_over_prob >= 0 and published_over_prob <= 1),
  check (published_under_prob >= 0 and published_under_prob <= 1),
  check (abs(raw_over_prob + raw_under_prob + push_prob - 1) < 0.000001),
  check (abs(decisive_raw_over_prob + decisive_raw_under_prob - 1) < 0.000001),
  check (abs(published_over_prob + published_under_prob - 1) < 0.000001),

  constraint mlb_tcs_market_fair_ck check (
    market_fair_over_prob >= 0 and market_fair_over_prob <= 1
    and market_fair_under_prob >= 0 and market_fair_under_prob <= 1
    and abs(market_fair_over_prob + market_fair_under_prob - 1) < 0.000001
  ),
  constraint mlb_tcs_home_win_prob_ck check (
    home_win_prob is null or (home_win_prob > 0 and home_win_prob < 1)
  ),
  constraint mlb_tcs_fatigue_identity_ck check (
    abs(candidate_fatigue_adj - beta * original_fatigue_adj) < 0.000001
  ),
  constraint mlb_tcs_distribution_ck check (
    (
      model_family = 'logistic'
      and discrete_mu_home is null
      and discrete_mu_away is null
      and discrete_phi is null
    )
    or
    (
      model_family = 'discrete_negbin'
      and beta = 1
      and home_win_prob is not null
      and discrete_mu_home is not null and discrete_mu_home > 0
      and discrete_mu_away is not null and discrete_mu_away > 0
      and discrete_phi is not null and discrete_phi > 0
    )
  ),
  constraint mlb_tcs_closing_group_ck check (
    (
      closing_total is null
      and closing_over_odds is null
      and closing_under_odds is null
      and closing_captured_at is null
    )
    or
    (
      closing_total is not null and closing_total > 0
      and closing_over_odds is not null and abs(closing_over_odds) >= 100
      and closing_under_odds is not null and abs(closing_under_odds) >= 100
      and closing_captured_at is not null
    )
  ),
  constraint mlb_tcs_pinnacle_group_ck check (
    (
      pinnacle_closing_total is null
      and pinnacle_over_odds is null
      and pinnacle_under_odds is null
      and pinnacle_fair_over_prob is null
      and pinnacle_captured_at is null
    )
    or
    (
      pinnacle_closing_total is not null and pinnacle_closing_total > 0
      and pinnacle_over_odds is not null and abs(pinnacle_over_odds) >= 100
      and pinnacle_under_odds is not null and abs(pinnacle_under_odds) >= 100
      and pinnacle_fair_over_prob is not null
      and pinnacle_fair_over_prob >= 0 and pinnacle_fair_over_prob <= 1
      and pinnacle_captured_at is not null
    )
  ),
  constraint mlb_tcs_score_pair_ck check (
    (final_away_runs is null and final_home_runs is null)
    or
    (
      final_away_runs is not null and final_away_runs >= 0
      and final_home_runs is not null and final_home_runs >= 0
      and (actual_total_runs is null or actual_total_runs = final_away_runs + final_home_runs)
    )
  ),
  constraint mlb_tcs_result_payload_ck check (
    (
      result_status = 'pending'
      and result_source is null
      and final_away_runs is null
      and final_home_runs is null
      and actual_total_runs is null
      and graded_at is null
    )
    or
    (
      result_status = 'void'
      and result_source is not null
      and actual_total_runs is null
      and graded_at is not null
    )
    or
    (
      result_status in ('over', 'under', 'push')
      and result_source is not null
      and actual_total_runs is not null and actual_total_runs >= 0
      and graded_at is not null
    )
  ),
  constraint mlb_tcs_outcome_ck check (
    result_status not in ('over', 'under', 'push')
    or (result_status = 'over' and actual_total_runs > market_total)
    or (result_status = 'under' and actual_total_runs < market_total)
    or (result_status = 'push' and actual_total_runs = market_total)
  )
);

create index idx_mlb_totals_calibration_date
  on public.mlb_totals_calibration_shadow (game_date, game_id);

create index idx_mlb_totals_calibration_pending
  on public.mlb_totals_calibration_shadow (game_date, game_id)
  where result_status = 'pending';

alter table public.mlb_totals_calibration_shadow enable row level security;

-- Make the intended backend-only boundary explicit. There are deliberately no
-- anon/authenticated policies and no DELETE grant.
revoke all privileges
  on table public.mlb_totals_calibration_shadow
  from public, anon, authenticated, service_role;

revoke all privileges
  on sequence public.mlb_totals_calibration_shadow_id_seq
  from public, anon, authenticated, service_role;

grant select, insert
  on table public.mlb_totals_calibration_shadow
  to service_role;

grant update (
  closing_total,
  closing_over_odds,
  closing_under_odds,
  closing_over_book,
  closing_under_book,
  closing_captured_at,
  pinnacle_closing_total,
  pinnacle_over_odds,
  pinnacle_under_odds,
  pinnacle_fair_over_prob,
  pinnacle_captured_at,
  result_status,
  result_source,
  final_away_runs,
  final_home_runs,
  actual_total_runs,
  graded_at
)
  on table public.mlb_totals_calibration_shadow
  to service_role;

grant usage, select
  on sequence public.mlb_totals_calibration_shadow_id_seq
  to service_role;

create function public.guard_mlb_totals_calibration_shadow_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  mutable_columns constant text[] := array[
    'closing_total',
    'closing_over_odds',
    'closing_under_odds',
    'closing_over_book',
    'closing_under_book',
    'closing_captured_at',
    'pinnacle_closing_total',
    'pinnacle_over_odds',
    'pinnacle_under_odds',
    'pinnacle_fair_over_prob',
    'pinnacle_captured_at',
    'result_status',
    'result_source',
    'final_away_runs',
    'final_home_runs',
    'actual_total_runs',
    'graded_at'
  ];
begin
  if (to_jsonb(new) - mutable_columns)
       is distinct from
     (to_jsonb(old) - mutable_columns) then
    raise exception 'MLB totals prediction-time fields are immutable after insertion';
  end if;

  if row(
       new.closing_total,
       new.closing_over_odds,
       new.closing_under_odds,
       new.closing_over_book,
       new.closing_under_book,
       new.closing_captured_at
     ) is distinct from row(
       old.closing_total,
       old.closing_over_odds,
       old.closing_under_odds,
       old.closing_over_book,
       old.closing_under_book,
       old.closing_captured_at
     )
     and (
       new.closing_captured_at is null
       or (
         old.closing_captured_at is not null
         and new.closing_captured_at <= old.closing_captured_at
       )
     ) then
    raise exception 'Closing-line enrichment cannot move backward';
  end if;

  if row(
       new.pinnacle_closing_total,
       new.pinnacle_over_odds,
       new.pinnacle_under_odds,
       new.pinnacle_fair_over_prob,
       new.pinnacle_captured_at
     ) is distinct from row(
       old.pinnacle_closing_total,
       old.pinnacle_over_odds,
       old.pinnacle_under_odds,
       old.pinnacle_fair_over_prob,
       old.pinnacle_captured_at
     )
     and (
       new.pinnacle_captured_at is null
       or (
         old.pinnacle_captured_at is not null
         and new.pinnacle_captured_at <= old.pinnacle_captured_at
       )
     ) then
    raise exception 'Pinnacle enrichment cannot move backward';
  end if;

  if old.result_status <> 'pending'
     and row(
       new.result_status,
       new.result_source,
       new.final_away_runs,
       new.final_home_runs,
       new.actual_total_runs,
       new.graded_at
     ) is distinct from row(
       old.result_status,
       old.result_source,
       old.final_away_runs,
       old.final_home_runs,
       old.actual_total_runs,
       old.graded_at
     ) then
    raise exception 'Settled MLB totals calibration results are immutable';
  end if;

  return new;
end;
$$;

create trigger guard_mlb_totals_calibration_shadow_update
before update on public.mlb_totals_calibration_shadow
for each row
execute function public.guard_mlb_totals_calibration_shadow_update();

revoke all privileges
  on function public.guard_mlb_totals_calibration_shadow_update()
  from public, anon, authenticated;

grant execute
  on function public.guard_mlb_totals_calibration_shadow_update()
  to service_role;
