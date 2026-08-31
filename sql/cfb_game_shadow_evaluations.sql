begin;

create table public.cfb_game_shadow_closing_observations (
  id bigint generated always as identity primary key,
  shadow_prediction_id bigint not null
    references public.cfb_game_shadow_predictions(id) on delete restrict,
  input_snapshot_id bigint not null
    references public.cfb_game_input_snapshots(id) on delete restrict,
  game_id text not null check (length(btrim(game_id)) between 1 and 160),
  observation_version text not null
    check (observation_version = 'cfb-game-shadow-close-observation-v1-2026'),
  quote_at timestamptz not null,
  kickoff_at timestamptz not null,
  event_home_team text not null check (length(btrim(event_home_team)) between 1 and 160),
  event_away_team text not null check (length(btrim(event_away_team)) between 1 and 160),

  us_source text check (us_source = 'the-odds-api-us-best-price-existing-hourly-capture'),
  us_home_ml_odds integer,
  us_away_ml_odds integer,
  us_home_ml_book text,
  us_away_ml_book text,
  us_market_fair_home_win_probability double precision,
  us_market_fair_away_win_probability double precision,
  us_home_spread double precision,
  us_away_spread double precision,
  us_home_spread_odds integer,
  us_away_spread_odds integer,
  us_home_spread_book text,
  us_away_spread_book text,
  us_market_fair_home_cover_probability double precision,
  us_market_fair_away_cover_probability double precision,

  pinnacle_source text check (pinnacle_source = 'pinnacle-existing-hourly-capture'),
  pinnacle_home_ml_odds integer,
  pinnacle_away_ml_odds integer,
  pinnacle_home_ml_book text,
  pinnacle_away_ml_book text,
  pinnacle_market_fair_home_win_probability double precision,
  pinnacle_market_fair_away_win_probability double precision,
  pinnacle_home_spread double precision,
  pinnacle_away_spread double precision,
  pinnacle_home_spread_odds integer,
  pinnacle_away_spread_odds integer,
  pinnacle_home_spread_book text,
  pinnacle_away_spread_book text,
  pinnacle_market_fair_home_cover_probability double precision,
  pinnacle_market_fair_away_cover_probability double precision,

  observation_fingerprint text not null check (observation_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),

  constraint cfb_game_shadow_close_pre_kickoff_ck check (quote_at < kickoff_at),
  constraint cfb_game_shadow_close_has_market_ck check (us_source is not null or pinnacle_source is not null),
  constraint cfb_game_shadow_close_us_ml_ck check (
    (
      us_home_ml_odds is null and us_away_ml_odds is null
      and us_home_ml_book is null and us_away_ml_book is null
      and us_market_fair_home_win_probability is null
      and us_market_fair_away_win_probability is null
    )
    or (
      us_home_ml_odds is not null and us_away_ml_odds is not null
      and abs(us_home_ml_odds) >= 100 and abs(us_away_ml_odds) >= 100
      and us_home_ml_book is not null and us_away_ml_book is not null
      and length(btrim(us_home_ml_book)) between 1 and 120
      and length(btrim(us_away_ml_book)) between 1 and 120
      and us_home_ml_book !~ '[[:cntrl:]]' and us_away_ml_book !~ '[[:cntrl:]]'
      and us_market_fair_home_win_probability is not null
      and us_market_fair_away_win_probability is not null
      and us_market_fair_home_win_probability between 0 and 1
      and us_market_fair_away_win_probability between 0 and 1
      and abs(us_market_fair_home_win_probability + us_market_fair_away_win_probability - 1) < 0.0000001
    )
  ),
  constraint cfb_game_shadow_close_us_spread_ck check (
    (
      us_home_spread is null and us_away_spread is null
      and us_home_spread_odds is null and us_away_spread_odds is null
      and us_home_spread_book is null and us_away_spread_book is null
      and us_market_fair_home_cover_probability is null
      and us_market_fair_away_cover_probability is null
    )
    or (
      us_home_spread is not null and us_away_spread is not null
      and abs(us_home_spread + us_away_spread) < 0.0000001
      and us_home_spread_odds is not null and us_away_spread_odds is not null
      and abs(us_home_spread_odds) >= 100 and abs(us_away_spread_odds) >= 100
      and us_home_spread_book is not null and us_away_spread_book is not null
      and length(btrim(us_home_spread_book)) between 1 and 120
      and length(btrim(us_away_spread_book)) between 1 and 120
      and us_home_spread_book !~ '[[:cntrl:]]' and us_away_spread_book !~ '[[:cntrl:]]'
      and us_market_fair_home_cover_probability is not null
      and us_market_fair_away_cover_probability is not null
      and us_market_fair_home_cover_probability between 0 and 1
      and us_market_fair_away_cover_probability between 0 and 1
      and abs(us_market_fair_home_cover_probability + us_market_fair_away_cover_probability - 1) < 0.0000001
    )
  ),
  constraint cfb_game_shadow_close_pinnacle_ml_ck check (
    (
      pinnacle_home_ml_odds is null and pinnacle_away_ml_odds is null
      and pinnacle_home_ml_book is null and pinnacle_away_ml_book is null
      and pinnacle_market_fair_home_win_probability is null
      and pinnacle_market_fair_away_win_probability is null
    )
    or (
      pinnacle_home_ml_odds is not null and pinnacle_away_ml_odds is not null
      and abs(pinnacle_home_ml_odds) >= 100 and abs(pinnacle_away_ml_odds) >= 100
      and pinnacle_home_ml_book is not null and pinnacle_away_ml_book is not null
      and length(btrim(pinnacle_home_ml_book)) between 1 and 120
      and length(btrim(pinnacle_away_ml_book)) between 1 and 120
      and pinnacle_home_ml_book !~ '[[:cntrl:]]' and pinnacle_away_ml_book !~ '[[:cntrl:]]'
      and pinnacle_market_fair_home_win_probability is not null
      and pinnacle_market_fair_away_win_probability is not null
      and pinnacle_market_fair_home_win_probability between 0 and 1
      and pinnacle_market_fair_away_win_probability between 0 and 1
      and abs(pinnacle_market_fair_home_win_probability + pinnacle_market_fair_away_win_probability - 1) < 0.0000001
    )
  ),
  constraint cfb_game_shadow_close_pinnacle_spread_ck check (
    (
      pinnacle_home_spread is null and pinnacle_away_spread is null
      and pinnacle_home_spread_odds is null and pinnacle_away_spread_odds is null
      and pinnacle_home_spread_book is null and pinnacle_away_spread_book is null
      and pinnacle_market_fair_home_cover_probability is null
      and pinnacle_market_fair_away_cover_probability is null
    )
    or (
      pinnacle_home_spread is not null and pinnacle_away_spread is not null
      and abs(pinnacle_home_spread + pinnacle_away_spread) < 0.0000001
      and pinnacle_home_spread_odds is not null and pinnacle_away_spread_odds is not null
      and abs(pinnacle_home_spread_odds) >= 100 and abs(pinnacle_away_spread_odds) >= 100
      and pinnacle_home_spread_book is not null and pinnacle_away_spread_book is not null
      and length(btrim(pinnacle_home_spread_book)) between 1 and 120
      and length(btrim(pinnacle_away_spread_book)) between 1 and 120
      and pinnacle_home_spread_book !~ '[[:cntrl:]]' and pinnacle_away_spread_book !~ '[[:cntrl:]]'
      and pinnacle_market_fair_home_cover_probability is not null
      and pinnacle_market_fair_away_cover_probability is not null
      and pinnacle_market_fair_home_cover_probability between 0 and 1
      and pinnacle_market_fair_away_cover_probability between 0 and 1
      and abs(pinnacle_market_fair_home_cover_probability + pinnacle_market_fair_away_cover_probability - 1) < 0.0000001
    )
  ),
  constraint cfb_game_shadow_close_source_ck check (
    (us_source is not null) = (
      us_home_ml_odds is not null or us_home_spread is not null
    )
    and (pinnacle_source is not null) = (
      pinnacle_home_ml_odds is not null or pinnacle_home_spread is not null
    )
  ),
  constraint cfb_game_shadow_close_prediction_quote_uk unique (shadow_prediction_id, quote_at),
  constraint cfb_game_shadow_close_fingerprint_uk unique (observation_fingerprint)
);

create index idx_cfb_game_shadow_close_prediction_time
  on public.cfb_game_shadow_closing_observations (shadow_prediction_id, quote_at desc);

alter table public.cfb_game_shadow_closing_observations enable row level security;

revoke all privileges on table public.cfb_game_shadow_closing_observations
  from public, anon, authenticated, service_role;
revoke all privileges on sequence public.cfb_game_shadow_closing_observations_id_seq
  from public, anon, authenticated, service_role;
grant select, insert on table public.cfb_game_shadow_closing_observations to service_role;
grant usage on sequence public.cfb_game_shadow_closing_observations_id_seq to service_role;

create function public.guard_cfb_game_shadow_closing_observation_insert()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  shadow_row public.cfb_game_shadow_predictions%rowtype;
  input_row public.cfb_game_input_snapshots%rowtype;
begin
  select * into strict shadow_row
    from public.cfb_game_shadow_predictions where id = new.shadow_prediction_id;
  select * into strict input_row
    from public.cfb_game_input_snapshots where id = shadow_row.input_snapshot_id;
  if new.input_snapshot_id <> shadow_row.input_snapshot_id
     or new.game_id <> shadow_row.game_id
     or new.kickoff_at <> shadow_row.kickoff_at
     or new.quote_at < shadow_row.prediction_at
     or new.event_home_team <> input_row.game_context->>'homeTeam'
     or new.event_away_team <> input_row.game_context->>'awayTeam' then
    raise exception 'CFB shadow close identity/orientation mismatch';
  end if;
  return new;
end;
$$;

create function public.prevent_cfb_game_shadow_closing_observation_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'CFB game shadow closing observations are immutable';
end;
$$;

revoke all on function public.guard_cfb_game_shadow_closing_observation_insert()
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_cfb_game_shadow_closing_observation_mutation()
  from public, anon, authenticated, service_role;
grant execute on function public.guard_cfb_game_shadow_closing_observation_insert() to service_role;
grant execute on function public.prevent_cfb_game_shadow_closing_observation_mutation() to service_role;

create trigger cfb_game_shadow_closing_observation_validate
before insert on public.cfb_game_shadow_closing_observations
for each row execute function public.guard_cfb_game_shadow_closing_observation_insert();

create trigger cfb_game_shadow_closing_observation_immutable
before update or delete on public.cfb_game_shadow_closing_observations
for each row execute function public.prevent_cfb_game_shadow_closing_observation_mutation();

create table public.cfb_game_shadow_evaluations (
  id bigint generated always as identity primary key,
  shadow_prediction_id bigint not null unique
    references public.cfb_game_shadow_predictions(id) on delete restrict,
  evaluation_version text not null check (evaluation_version = 'cfb-game-shadow-eval-v1-2026'),
  evaluated_at timestamptz not null,
  result_source text not null check (result_source = 'espn-fbs-scoreboard-existing-grading-feed'),
  result_game_id text not null check (length(btrim(result_game_id)) between 1 and 160),
  result_scheduled_at timestamptz not null,
  result_home_espn_team_id text not null check (length(btrim(result_home_espn_team_id)) between 1 and 80),
  result_away_espn_team_id text not null check (length(btrim(result_away_espn_team_id)) between 1 and 80),
  result_status text not null check (result_status = 'final'),
  final_home_score integer not null check (final_home_score >= 0),
  final_away_score integer not null check (final_away_score >= 0),
  actual_home_margin integer not null,
  home_win_actual smallint check (home_win_actual in (0, 1)),

  source_home_win_probability double precision not null check (source_home_win_probability between 0 and 1),
  source_projected_home_margin double precision not null,
  source_home_spread double precision,
  source_home_cover_probability double precision check (source_home_cover_probability between 0 and 1),
  source_away_cover_probability double precision check (source_away_cover_probability between 0 and 1),
  source_spread_push_probability double precision check (source_spread_push_probability between 0 and 1),

  brier_ml double precision check (brier_ml between 0 and 1),
  log_loss_ml double precision check (log_loss_ml >= 0),
  margin_error double precision not null,
  margin_absolute_error double precision not null check (margin_absolute_error >= 0),
  margin_squared_error double precision not null check (margin_squared_error >= 0),
  ats_home_result_value double precision,
  ats_result text check (ats_result in ('HOME_COVER', 'AWAY_COVER', 'PUSH')),
  spread_home_actual_decisive smallint check (spread_home_actual_decisive in (0, 1)),
  brier_spread_decisive double precision check (brier_spread_decisive between 0 and 1),
  log_loss_spread_decisive double precision check (log_loss_spread_decisive >= 0),

  us_closing_observation_id bigint
    references public.cfb_game_shadow_closing_observations(id) on delete restrict,
  us_closing_home_ml_fair_probability double precision check (us_closing_home_ml_fair_probability between 0 and 1),
  us_closing_away_ml_fair_probability double precision check (us_closing_away_ml_fair_probability between 0 and 1),
  us_closing_home_spread double precision,
  us_closing_away_spread double precision,
  us_closing_home_cover_fair_probability double precision check (us_closing_home_cover_fair_probability between 0 and 1),
  us_closing_away_cover_fair_probability double precision check (us_closing_away_cover_fair_probability between 0 and 1),
  us_home_spread_clv_points double precision,
  us_away_spread_clv_points double precision,
  us_home_ml_market_move double precision,
  us_away_ml_market_move double precision,
  shadow_vs_us_closing_home_ml_disagreement double precision,
  shadow_vs_us_closing_away_ml_disagreement double precision,
  shadow_vs_us_close_points double precision,
  shadow_vs_us_closing_home_cover_disagreement double precision,
  shadow_vs_us_closing_away_cover_disagreement double precision,

  pinnacle_closing_observation_id bigint
    references public.cfb_game_shadow_closing_observations(id) on delete restrict,
  pinnacle_closing_home_ml_fair_probability double precision check (pinnacle_closing_home_ml_fair_probability between 0 and 1),
  pinnacle_closing_away_ml_fair_probability double precision check (pinnacle_closing_away_ml_fair_probability between 0 and 1),
  pinnacle_closing_home_spread double precision,
  pinnacle_closing_away_spread double precision,
  pinnacle_closing_home_cover_fair_probability double precision check (pinnacle_closing_home_cover_fair_probability between 0 and 1),
  pinnacle_closing_away_cover_fair_probability double precision check (pinnacle_closing_away_cover_fair_probability between 0 and 1),
  pinnacle_home_spread_clv_points double precision,
  pinnacle_away_spread_clv_points double precision,
  pinnacle_home_ml_market_move double precision,
  pinnacle_away_ml_market_move double precision,
  shadow_vs_pinnacle_closing_home_ml_disagreement double precision,
  shadow_vs_pinnacle_closing_away_ml_disagreement double precision,
  shadow_vs_pinnacle_close_points double precision,
  shadow_vs_pinnacle_closing_home_cover_disagreement double precision,
  shadow_vs_pinnacle_closing_away_cover_disagreement double precision,

  metric_fingerprint text not null unique check (metric_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),

  constraint cfb_game_shadow_eval_score_ck check (
    actual_home_margin = final_home_score - final_away_score
  ),
  constraint cfb_game_shadow_eval_ml_outcome_ck check (
    (
      actual_home_margin = 0 and home_win_actual is null
      and brier_ml is null and log_loss_ml is null
    )
    or (
      actual_home_margin <> 0
      and home_win_actual = case when actual_home_margin > 0 then 1 else 0 end
      and brier_ml is not null and log_loss_ml is not null
    )
  ),
  constraint cfb_game_shadow_eval_ml_metric_ck check (
    (
      home_win_actual is null and brier_ml is null and log_loss_ml is null
    )
    or (
      home_win_actual is not null
      and abs(brier_ml - power(source_home_win_probability - home_win_actual, 2)) < 0.0000001
      and abs(log_loss_ml - case
        when home_win_actual = 1
          then -ln(least(1 - 1e-15, greatest(1e-15, source_home_win_probability)))
        else -ln(1 - least(1 - 1e-15, greatest(1e-15, source_home_win_probability)))
      end) < 0.0000001
    )
  ),
  constraint cfb_game_shadow_eval_margin_metric_ck check (
    abs(margin_error - (actual_home_margin - source_projected_home_margin)) < 0.0000001
    and abs(margin_absolute_error - abs(margin_error)) < 0.0000001
    and abs(margin_squared_error - margin_error * margin_error) < 0.0000001
  ),
  constraint cfb_game_shadow_eval_ats_ck check (
    (
      source_home_spread is null
      and source_home_cover_probability is null
      and source_away_cover_probability is null
      and source_spread_push_probability is null
      and ats_home_result_value is null and ats_result is null
      and spread_home_actual_decisive is null
      and brier_spread_decisive is null and log_loss_spread_decisive is null
    )
    or (
      source_home_spread is not null
      and source_home_cover_probability is not null
      and source_away_cover_probability is not null
      and source_spread_push_probability is not null
      and ats_home_result_value is not null and ats_result is not null
      and abs(ats_home_result_value - (actual_home_margin + source_home_spread)) < 0.0000001
      and (
        (ats_home_result_value = 0 and ats_result = 'PUSH'
          and spread_home_actual_decisive is null
          and brier_spread_decisive is null and log_loss_spread_decisive is null)
        or
        (ats_home_result_value > 0 and ats_result = 'HOME_COVER'
          and spread_home_actual_decisive = 1
          and brier_spread_decisive is not null and log_loss_spread_decisive is not null)
        or
        (ats_home_result_value < 0 and ats_result = 'AWAY_COVER'
          and spread_home_actual_decisive = 0
          and brier_spread_decisive is not null and log_loss_spread_decisive is not null)
      )
    )
  ),
  constraint cfb_game_shadow_eval_spread_metric_ck check (
    (
      spread_home_actual_decisive is null
      and brier_spread_decisive is null and log_loss_spread_decisive is null
    )
    or (
      spread_home_actual_decisive is not null
      and abs(brier_spread_decisive
        - power(source_home_cover_probability - spread_home_actual_decisive, 2)) < 0.0000001
      and abs(log_loss_spread_decisive - case
        when spread_home_actual_decisive = 1
          then -ln(least(1 - 1e-15, greatest(1e-15, source_home_cover_probability)))
        else -ln(1 - least(1 - 1e-15, greatest(1e-15, source_home_cover_probability)))
      end) < 0.0000001
    )
  ),
  constraint cfb_game_shadow_eval_us_close_group_ck check (
    us_closing_observation_id is not null
    or (
      us_closing_home_ml_fair_probability is null
      and us_closing_away_ml_fair_probability is null
      and us_closing_home_spread is null and us_closing_away_spread is null
      and us_closing_home_cover_fair_probability is null
      and us_closing_away_cover_fair_probability is null
      and us_home_spread_clv_points is null and us_away_spread_clv_points is null
      and us_home_ml_market_move is null and us_away_ml_market_move is null
      and shadow_vs_us_closing_home_ml_disagreement is null
      and shadow_vs_us_closing_away_ml_disagreement is null
      and shadow_vs_us_close_points is null
      and shadow_vs_us_closing_home_cover_disagreement is null
      and shadow_vs_us_closing_away_cover_disagreement is null
    )
  ),
  constraint cfb_game_shadow_eval_pinnacle_close_group_ck check (
    pinnacle_closing_observation_id is not null
    or (
      pinnacle_closing_home_ml_fair_probability is null
      and pinnacle_closing_away_ml_fair_probability is null
      and pinnacle_closing_home_spread is null and pinnacle_closing_away_spread is null
      and pinnacle_closing_home_cover_fair_probability is null
      and pinnacle_closing_away_cover_fair_probability is null
      and pinnacle_home_spread_clv_points is null and pinnacle_away_spread_clv_points is null
      and pinnacle_home_ml_market_move is null and pinnacle_away_ml_market_move is null
      and shadow_vs_pinnacle_closing_home_ml_disagreement is null
      and shadow_vs_pinnacle_closing_away_ml_disagreement is null
      and shadow_vs_pinnacle_close_points is null
      and shadow_vs_pinnacle_closing_home_cover_disagreement is null
      and shadow_vs_pinnacle_closing_away_cover_disagreement is null
    )
  )
);

create index idx_cfb_game_shadow_eval_evaluated_at
  on public.cfb_game_shadow_evaluations (evaluated_at, shadow_prediction_id);

alter table public.cfb_game_shadow_evaluations enable row level security;

revoke all privileges on table public.cfb_game_shadow_evaluations
  from public, anon, authenticated, service_role;
revoke all privileges on sequence public.cfb_game_shadow_evaluations_id_seq
  from public, anon, authenticated, service_role;
grant select, insert on table public.cfb_game_shadow_evaluations to service_role;
grant usage on sequence public.cfb_game_shadow_evaluations_id_seq to service_role;

create function public.guard_cfb_game_shadow_evaluation_insert()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  shadow_row public.cfb_game_shadow_predictions%rowtype;
  us_row public.cfb_game_shadow_closing_observations%rowtype;
  pin_row public.cfb_game_shadow_closing_observations%rowtype;
begin
  select * into strict shadow_row
    from public.cfb_game_shadow_predictions where id = new.shadow_prediction_id;
  if new.result_home_espn_team_id <> shadow_row.home_espn_team_id
     or new.result_away_espn_team_id <> shadow_row.away_espn_team_id
     or abs(extract(epoch from (new.result_scheduled_at - shadow_row.kickoff_at))) > 900
     or new.evaluated_at < new.result_scheduled_at
     or new.source_home_win_probability is distinct from shadow_row.home_win_probability
     or new.source_projected_home_margin is distinct from shadow_row.projected_home_margin
     or new.source_home_spread is distinct from shadow_row.home_spread
     or new.source_home_cover_probability is distinct from shadow_row.home_cover_probability
     or new.source_away_cover_probability is distinct from shadow_row.away_cover_probability
     or new.source_spread_push_probability is distinct from shadow_row.spread_push_probability then
    raise exception 'CFB shadow evaluation prediction/result identity mismatch';
  end if;

  if new.us_closing_observation_id is not null then
    select * into strict us_row from public.cfb_game_shadow_closing_observations
      where id = new.us_closing_observation_id;
    if us_row.shadow_prediction_id <> new.shadow_prediction_id
       or us_row.quote_at >= shadow_row.kickoff_at
       or new.us_closing_home_ml_fair_probability is distinct from us_row.us_market_fair_home_win_probability
       or new.us_closing_away_ml_fair_probability is distinct from us_row.us_market_fair_away_win_probability
       or new.us_closing_home_spread is distinct from us_row.us_home_spread
       or new.us_closing_away_spread is distinct from us_row.us_away_spread
       or new.us_closing_home_cover_fair_probability is distinct from us_row.us_market_fair_home_cover_probability
       or new.us_closing_away_cover_fair_probability is distinct from us_row.us_market_fair_away_cover_probability then
      raise exception 'CFB shadow evaluation US close mismatch';
    end if;
  end if;

  if new.pinnacle_closing_observation_id is not null then
    select * into strict pin_row from public.cfb_game_shadow_closing_observations
      where id = new.pinnacle_closing_observation_id;
    if pin_row.shadow_prediction_id <> new.shadow_prediction_id
       or pin_row.quote_at >= shadow_row.kickoff_at
       or new.pinnacle_closing_home_ml_fair_probability is distinct from pin_row.pinnacle_market_fair_home_win_probability
       or new.pinnacle_closing_away_ml_fair_probability is distinct from pin_row.pinnacle_market_fair_away_win_probability
       or new.pinnacle_closing_home_spread is distinct from pin_row.pinnacle_home_spread
       or new.pinnacle_closing_away_spread is distinct from pin_row.pinnacle_away_spread
       or new.pinnacle_closing_home_cover_fair_probability is distinct from pin_row.pinnacle_market_fair_home_cover_probability
       or new.pinnacle_closing_away_cover_fair_probability is distinct from pin_row.pinnacle_market_fair_away_cover_probability then
      raise exception 'CFB shadow evaluation Pinnacle close mismatch';
    end if;
  end if;
  return new;
end;
$$;

create function public.prevent_cfb_game_shadow_evaluation_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'CFB game shadow evaluations are immutable';
end;
$$;

revoke all on function public.guard_cfb_game_shadow_evaluation_insert()
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_cfb_game_shadow_evaluation_mutation()
  from public, anon, authenticated, service_role;
grant execute on function public.guard_cfb_game_shadow_evaluation_insert() to service_role;
grant execute on function public.prevent_cfb_game_shadow_evaluation_mutation() to service_role;

create trigger cfb_game_shadow_evaluation_validate
before insert on public.cfb_game_shadow_evaluations
for each row execute function public.guard_cfb_game_shadow_evaluation_insert();

create trigger cfb_game_shadow_evaluation_immutable
before update or delete on public.cfb_game_shadow_evaluations
for each row execute function public.prevent_cfb_game_shadow_evaluation_mutation();

commit;
