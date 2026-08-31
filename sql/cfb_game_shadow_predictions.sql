begin;

create table public.cfb_game_shadow_predictions (
  id bigint generated always as identity primary key,
  input_snapshot_id bigint not null
    references public.cfb_game_input_snapshots(id) on delete restrict,
  game_id text not null check (length(btrim(game_id)) between 1 and 160),
  season smallint not null check (season between 2000 and 2100),
  game_date date not null,
  prediction_at timestamptz not null,
  kickoff_at timestamptz not null,
  model_version text not null
    check (model_version = 'cfb-game-preseason-shadow-v1-2026'),
  team_model_version text not null
    check (team_model_version = 'cfb-preseason-prior-shadow-v1-2026'),
  experiment_version text not null
    check (experiment_version = 'cfb-game-preseason-shadow-collection-v1-2026'),
  ml_probability_method text not null check (ml_probability_method = 'normal-margin-cdf-v1'),
  spread_probability_method text not null check (spread_probability_method = 'cfb-discrete-margin-pmf-v1'),
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  output_fingerprint text not null check (output_fingerprint ~ '^[0-9a-f]{64}$'),

  home_team_name text not null check (length(btrim(home_team_name)) between 1 and 160),
  away_team_name text not null check (length(btrim(away_team_name)) between 1 and 160),
  home_espn_team_id text not null check (length(btrim(home_espn_team_id)) between 1 and 80),
  away_espn_team_id text not null check (length(btrim(away_espn_team_id)) between 1 and 80),
  home_cfbd_team_id bigint not null check (home_cfbd_team_id > 0),
  away_cfbd_team_id bigint not null check (away_cfbd_team_id > 0),
  home_team_status text not null check (home_team_status in ('rated-input-ready', 'suspect')),
  away_team_status text not null check (away_team_status in ('rated-input-ready', 'suspect')),

  neutral_site_status text not null check (neutral_site_status in ('neutral', 'non-neutral')),
  home_field_adjustment double precision not null,
  home_team_rating double precision not null,
  away_team_rating double precision not null,
  home_team_uncertainty double precision not null check (home_team_uncertainty > 0),
  away_team_uncertainty double precision not null check (away_team_uncertainty > 0),
  combined_rating_uncertainty double precision not null check (combined_rating_uncertainty > 0),
  base_game_sigma double precision not null check (base_game_sigma = 15.5),
  predictive_sigma double precision not null check (predictive_sigma > 0),
  projected_home_margin double precision not null,
  home_win_probability double precision not null check (home_win_probability between 0 and 1),
  away_win_probability double precision not null check (away_win_probability between 0 and 1),

  market_source text not null
    check (market_source = 'the-odds-api-us-best-price'),
  market_quote_at timestamptz not null,
  home_ml_odds integer,
  away_ml_odds integer,
  home_ml_book text,
  away_ml_book text,
  market_fair_home_win_probability double precision,
  market_fair_away_win_probability double precision,
  home_ml_disagreement double precision,
  away_ml_disagreement double precision,

  home_spread double precision,
  away_spread double precision,
  home_spread_odds integer,
  away_spread_odds integer,
  home_spread_book text,
  away_spread_book text,
  home_cover_probability double precision,
  away_cover_probability double precision,
  spread_push_probability double precision,
  point_disagreement double precision,
  market_fair_home_cover_probability double precision,
  market_fair_away_cover_probability double precision,
  home_spread_disagreement double precision,
  away_spread_disagreement double precision,
  created_at timestamptz not null default now(),

  constraint cfb_game_shadow_identity_ck check (
    home_espn_team_id <> away_espn_team_id
    and home_cfbd_team_id <> away_cfbd_team_id
  ),
  constraint cfb_game_shadow_pre_kickoff_ck check (
    prediction_at < kickoff_at and market_quote_at <= prediction_at
  ),
  constraint cfb_game_shadow_hfa_ck check (
    (neutral_site_status = 'neutral' and home_field_adjustment = 0)
    or (neutral_site_status = 'non-neutral' and home_field_adjustment = 3)
  ),
  constraint cfb_game_shadow_uncertainty_ck check (
    abs(combined_rating_uncertainty * combined_rating_uncertainty
      - (home_team_uncertainty * home_team_uncertainty
        + away_team_uncertainty * away_team_uncertainty)) < 0.00001
    and abs(predictive_sigma * predictive_sigma
      - (base_game_sigma * base_game_sigma
        + combined_rating_uncertainty * combined_rating_uncertainty)) < 0.00001
  ),
  constraint cfb_game_shadow_margin_ck check (
    abs(projected_home_margin
      - (home_team_rating - away_team_rating + home_field_adjustment)) < 0.00001
  ),
  constraint cfb_game_shadow_ml_complement_ck check (
    abs(home_win_probability + away_win_probability - 1) < 0.0000001
  ),
  constraint cfb_game_shadow_ml_price_book_ck check (
    ((home_ml_odds is null and home_ml_book is null)
      or (abs(home_ml_odds) >= 100 and length(btrim(home_ml_book)) between 1 and 120
        and home_ml_book !~ '[[:cntrl:]]'))
    and ((away_ml_odds is null and away_ml_book is null)
      or (abs(away_ml_odds) >= 100 and length(btrim(away_ml_book)) between 1 and 120
        and away_ml_book !~ '[[:cntrl:]]'))
  ),
  constraint cfb_game_shadow_ml_market_ck check (
    (
      market_fair_home_win_probability is null
      and market_fair_away_win_probability is null
      and home_ml_disagreement is null
      and away_ml_disagreement is null
    )
    or (
      home_ml_odds is not null and away_ml_odds is not null
      and market_fair_home_win_probability is not null
      and market_fair_away_win_probability is not null
      and home_ml_disagreement is not null
      and away_ml_disagreement is not null
      and market_fair_home_win_probability between 0 and 1
      and market_fair_away_win_probability between 0 and 1
      and abs(market_fair_home_win_probability + market_fair_away_win_probability - 1) < 0.0000001
      and abs(home_ml_disagreement
        - (home_win_probability - market_fair_home_win_probability)) < 0.0000001
      and abs(away_ml_disagreement
        - (away_win_probability - market_fair_away_win_probability)) < 0.0000001
    )
  ),
  constraint cfb_game_shadow_spread_ck check (
    (
      home_spread is null and away_spread is null
      and home_spread_odds is null and away_spread_odds is null
      and home_spread_book is null and away_spread_book is null
      and home_cover_probability is null and away_cover_probability is null
      and spread_push_probability is null and point_disagreement is null
      and market_fair_home_cover_probability is null
      and market_fair_away_cover_probability is null
      and home_spread_disagreement is null and away_spread_disagreement is null
    )
    or (
      home_spread is not null and away_spread is not null
      and home_cover_probability is not null and away_cover_probability is not null
      and spread_push_probability is not null and point_disagreement is not null
      and abs(home_spread + away_spread) < 0.0000001
      and home_cover_probability between 0 and 1
      and away_cover_probability between 0 and 1
      and spread_push_probability between 0 and 1
      and abs(home_cover_probability + away_cover_probability - 1) < 0.0000001
      and abs(point_disagreement - (projected_home_margin + home_spread)) < 0.00001
      and ((home_spread_odds is null and home_spread_book is null)
        or (abs(home_spread_odds) >= 100 and length(btrim(home_spread_book)) between 1 and 120
          and home_spread_book !~ '[[:cntrl:]]'))
      and ((away_spread_odds is null and away_spread_book is null)
        or (abs(away_spread_odds) >= 100 and length(btrim(away_spread_book)) between 1 and 120
          and away_spread_book !~ '[[:cntrl:]]'))
      and (
        (
          market_fair_home_cover_probability is null
          and market_fair_away_cover_probability is null
          and home_spread_disagreement is null
          and away_spread_disagreement is null
        )
        or (
          home_spread_odds is not null and away_spread_odds is not null
          and market_fair_home_cover_probability is not null
          and market_fair_away_cover_probability is not null
          and home_spread_disagreement is not null
          and away_spread_disagreement is not null
          and market_fair_home_cover_probability between 0 and 1
          and market_fair_away_cover_probability between 0 and 1
          and abs(market_fair_home_cover_probability
            + market_fair_away_cover_probability - 1) < 0.0000001
          and abs(home_spread_disagreement
            - (home_cover_probability - market_fair_home_cover_probability)) < 0.0000001
          and abs(away_spread_disagreement
            - (away_cover_probability - market_fair_away_cover_probability)) < 0.0000001
        )
      )
    )
  ),
  constraint cfb_game_shadow_input_model_uk unique (input_snapshot_id, model_version),
  constraint cfb_game_shadow_output_fingerprint_uk unique (output_fingerprint)
);

create index idx_cfb_game_shadow_schedule
  on public.cfb_game_shadow_predictions (season, kickoff_at, game_id);

alter table public.cfb_game_shadow_predictions enable row level security;

revoke all privileges
  on table public.cfb_game_shadow_predictions
  from public, anon, authenticated, service_role;

revoke all privileges
  on sequence public.cfb_game_shadow_predictions_id_seq
  from public, anon, authenticated, service_role;

grant select, insert
  on table public.cfb_game_shadow_predictions
  to service_role;

grant usage
  on sequence public.cfb_game_shadow_predictions_id_seq
  to service_role;

create function public.guard_cfb_game_shadow_prediction_insert()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  input_row public.cfb_game_input_snapshots%rowtype;
  home_snapshot public.cfb_team_preseason_snapshots%rowtype;
  away_snapshot public.cfb_team_preseason_snapshots%rowtype;
begin
  select * into strict input_row
    from public.cfb_game_input_snapshots where id = new.input_snapshot_id;
  select * into strict home_snapshot
    from public.cfb_team_preseason_snapshots where id = input_row.home_team_snapshot_id;
  select * into strict away_snapshot
    from public.cfb_team_preseason_snapshots where id = input_row.away_team_snapshot_id;

  if new.game_id <> input_row.game_id
     or new.season <> input_row.season
     or new.game_date <> input_row.game_date
     or new.prediction_at <> input_row.prediction_at
     or new.kickoff_at <> input_row.kickoff_at
     or new.model_version <> input_row.model_version
     or new.experiment_version <> input_row.experiment_version
     or new.input_fingerprint <> input_row.input_hash
     or new.neutral_site_status <> input_row.neutral_site_status
     or abs(new.projected_home_margin - input_row.predicted_margin_mean) >= 0.0000001
     or abs(new.predictive_sigma - input_row.predicted_margin_sd) >= 0.0000001 then
    raise exception 'CFB shadow output/input snapshot mismatch';
  end if;

  if new.home_team_name <> home_snapshot.team_name
     or new.away_team_name <> away_snapshot.team_name
     or new.home_espn_team_id <> home_snapshot.espn_team_id
     or new.away_espn_team_id <> away_snapshot.espn_team_id
     or new.home_cfbd_team_id <> home_snapshot.cfbd_team_id
     or new.away_cfbd_team_id <> away_snapshot.cfbd_team_id then
    raise exception 'CFB shadow output team orientation mismatch';
  end if;
  return new;
end;
$$;

create function public.prevent_cfb_game_shadow_prediction_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'CFB game shadow predictions are immutable';
end;
$$;

revoke all on function public.guard_cfb_game_shadow_prediction_insert()
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_cfb_game_shadow_prediction_mutation()
  from public, anon, authenticated, service_role;
grant execute on function public.guard_cfb_game_shadow_prediction_insert() to service_role;
grant execute on function public.prevent_cfb_game_shadow_prediction_mutation() to service_role;

create trigger cfb_game_shadow_prediction_validate
before insert on public.cfb_game_shadow_predictions
for each row execute function public.guard_cfb_game_shadow_prediction_insert();

create trigger cfb_game_shadow_prediction_immutable
before update or delete on public.cfb_game_shadow_predictions
for each row execute function public.prevent_cfb_game_shadow_prediction_mutation();

commit;
