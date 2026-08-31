-- PROPOSAL ONLY — DO NOT APPLY without a separate owner-approved schema step.
-- Offline/shadow-only CFB preseason evidence. No customer model or current ledger
-- path depends on these objects. Historical model_predictions rows remain NULL.

begin;

create table public.cfb_team_preseason_snapshots (
  id bigint generated always as identity primary key,
  season smallint not null check (season between 2000 and 2100),
  contract_version text not null
    check (contract_version ~ '^cfb-preseason-input-v[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  snapshot_at timestamptz not null,

  team_name text not null check (length(btrim(team_name)) between 1 and 160),
  espn_team_id text not null check (length(btrim(espn_team_id)) between 1 and 80),
  cfbd_team_id bigint not null check (cfbd_team_id > 0),
  identity_status text not null check (identity_status in ('exact', 'mapped')),
  identity_reason text,

  -- These JSON objects match cfbPreseasonInput's immutable adapter output exactly.
  -- Unknown values remain JSON null; source availability is explicit inside sources.
  sources jsonb not null check (
    jsonb_typeof(sources) = 'object'
    and sources ?& array[
      'teams', 'roster', 'returningProduction', 'transfers', 'talent',
      'recruitingTeams', 'recruitingPlayers', 'coaching', 'externalRatings'
    ]
  ),
  prior_references jsonb not null check (jsonb_typeof(prior_references) = 'object'),
  quarterback jsonb not null check (
    jsonb_typeof(quarterback) = 'object'
    and quarterback ? 'category'
    and coalesce(quarterback->>'category' in (
      'returning-established-starter',
      'returning-roster-new-starter',
      'confirmed-transfer-starter',
      'freshman-new-starter',
      'open-competition',
      'confirmed-unavailable',
      'unknown-unverified'
    ), false)
  ),
  roster jsonb not null check (jsonb_typeof(roster) = 'object'),
  returning_production jsonb not null check (jsonb_typeof(returning_production) = 'object'),
  transfers jsonb not null check (
    jsonb_typeof(transfers) = 'object'
    and coalesce(jsonb_typeof(transfers->'arrivals') = 'array', false)
    and coalesce(jsonb_typeof(transfers->'departures') = 'array', false)
  ),
  talent jsonb not null check (jsonb_typeof(talent) = 'object'),
  coaching jsonb not null check (jsonb_typeof(coaching) = 'object'),
  quality jsonb not null check (
    jsonb_typeof(quality) = 'object'
    and quality ? 'completeness'
    and case
      when jsonb_typeof(quality->'completeness') = 'number'
        then (quality->>'completeness')::double precision between 0 and 1
      else false
    end
  ),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),

  constraint cfb_team_preseason_snapshot_identity_uk
    unique (season, cfbd_team_id, contract_version, input_hash)
);

create index idx_cfb_team_preseason_snapshot_lookup
  on public.cfb_team_preseason_snapshots (season, cfbd_team_id, snapshot_at desc);

alter table public.cfb_team_preseason_snapshots enable row level security;

revoke all privileges
  on table public.cfb_team_preseason_snapshots
  from public, anon, authenticated, service_role;

revoke all privileges
  on sequence public.cfb_team_preseason_snapshots_id_seq
  from public, anon, authenticated, service_role;

grant select, insert
  on table public.cfb_team_preseason_snapshots
  to service_role;

grant usage
  on sequence public.cfb_team_preseason_snapshots_id_seq
  to service_role;

create function public.prevent_cfb_team_preseason_snapshot_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'CFB team preseason snapshots are immutable';
end;
$$;

revoke all on function public.prevent_cfb_team_preseason_snapshot_mutation()
  from public, anon, authenticated, service_role;
grant execute on function public.prevent_cfb_team_preseason_snapshot_mutation() to service_role;

create trigger cfb_team_preseason_snapshot_immutable
before update or delete on public.cfb_team_preseason_snapshots
for each row execute function public.prevent_cfb_team_preseason_snapshot_mutation();

-- Game-level evidence freezes the exact home/away team snapshots, their weighting,
-- model/experiment versions, game context, and shadow margin distribution that existed
-- at one pre-kickoff prediction instant.
create table public.cfb_game_input_snapshots (
  id bigint generated always as identity primary key,
  game_id text not null check (length(btrim(game_id)) between 1 and 160),
  season smallint not null check (season between 2000 and 2100),
  game_date date not null,
  prediction_at timestamptz not null,
  kickoff_at timestamptz not null,
  contract_version text not null
    check (contract_version ~ '^cfb-preseason-input-v[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  model_version text not null
    check (model_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  experiment_version text not null
    check (experiment_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),

  home_team_snapshot_id bigint not null
    references public.cfb_team_preseason_snapshots(id) on delete restrict,
  away_team_snapshot_id bigint not null
    references public.cfb_team_preseason_snapshots(id) on delete restrict,
  home_cfbd_team_id bigint not null check (home_cfbd_team_id > 0),
  away_cfbd_team_id bigint not null check (away_cfbd_team_id > 0),
  neutral_site_status text not null
    check (neutral_site_status in ('neutral', 'non-neutral', 'unknown')),
  input_status text not null
    check (input_status in ('rated', 'suspect', 'market-only', 'blocked')),
  game_context jsonb not null check (jsonb_typeof(game_context) = 'object'),
  quality jsonb not null check (jsonb_typeof(quality) = 'object'),

  home_current_season_weight double precision
    check (home_current_season_weight between 0 and 1),
  away_current_season_weight double precision
    check (away_current_season_weight between 0 and 1),
  predicted_margin_mean double precision,
  predicted_margin_sd double precision check (predicted_margin_sd > 0),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),

  constraint cfb_game_input_different_teams_ck check (
    home_team_snapshot_id <> away_team_snapshot_id
    and home_cfbd_team_id <> away_cfbd_team_id
  ),
  constraint cfb_game_input_pre_kickoff_ck check (prediction_at < kickoff_at),
  constraint cfb_game_input_model_state_ck check (
    (
      input_status in ('rated', 'suspect')
      and home_current_season_weight is not null
      and away_current_season_weight is not null
      and predicted_margin_mean is not null
      and predicted_margin_sd is not null
    )
    or
    (
      input_status in ('market-only', 'blocked')
      and predicted_margin_mean is null
      and predicted_margin_sd is null
    )
  ),
  constraint cfb_game_input_snapshot_uk
    unique (game_id, prediction_at, contract_version, model_version, experiment_version),
  constraint cfb_game_input_hash_uk unique (input_hash)
);

create index idx_cfb_game_input_snapshot_schedule
  on public.cfb_game_input_snapshots (season, kickoff_at, game_id);

alter table public.cfb_game_input_snapshots enable row level security;

revoke all privileges
  on table public.cfb_game_input_snapshots
  from public, anon, authenticated, service_role;

revoke all privileges
  on sequence public.cfb_game_input_snapshots_id_seq
  from public, anon, authenticated, service_role;

grant select, insert
  on table public.cfb_game_input_snapshots
  to service_role;

grant usage
  on sequence public.cfb_game_input_snapshots_id_seq
  to service_role;

create function public.guard_cfb_game_input_snapshot_insert()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  home_snapshot public.cfb_team_preseason_snapshots%rowtype;
  away_snapshot public.cfb_team_preseason_snapshots%rowtype;
begin
  select * into strict home_snapshot
    from public.cfb_team_preseason_snapshots where id = new.home_team_snapshot_id;
  select * into strict away_snapshot
    from public.cfb_team_preseason_snapshots where id = new.away_team_snapshot_id;

  if home_snapshot.season <> new.season or away_snapshot.season <> new.season then
    raise exception 'CFB game/team snapshot season mismatch';
  end if;
  if home_snapshot.cfbd_team_id <> new.home_cfbd_team_id
     or away_snapshot.cfbd_team_id <> new.away_cfbd_team_id then
    raise exception 'CFB game/team identity mismatch';
  end if;
  if home_snapshot.contract_version <> new.contract_version
     or away_snapshot.contract_version <> new.contract_version then
    raise exception 'CFB game/team contract version mismatch';
  end if;
  if home_snapshot.snapshot_at > new.prediction_at
     or away_snapshot.snapshot_at > new.prediction_at then
    raise exception 'CFB game input cannot use a future team snapshot';
  end if;
  return new;
end;
$$;

create function public.prevent_cfb_game_input_snapshot_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'CFB game input snapshots are immutable';
end;
$$;

revoke all on function public.guard_cfb_game_input_snapshot_insert()
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_cfb_game_input_snapshot_mutation()
  from public, anon, authenticated, service_role;
grant execute on function public.guard_cfb_game_input_snapshot_insert() to service_role;
grant execute on function public.prevent_cfb_game_input_snapshot_mutation() to service_role;

create trigger cfb_game_input_snapshot_validate
before insert on public.cfb_game_input_snapshots
for each row execute function public.guard_cfb_game_input_snapshot_insert();

create trigger cfb_game_input_snapshot_immutable
before update or delete on public.cfb_game_input_snapshots
for each row execute function public.prevent_cfb_game_input_snapshot_mutation();

-- FUTURE LEDGER LINK — still unapplied. The nullable, no-default column preserves
-- all historical/non-CFB rows. Its separate insert validator prevents a prediction
-- from linking to another game/date/prediction context. Its update trigger forbids
-- later backfill or replacement while leaving normal grading/closing updates alone.
alter table public.model_predictions
  add column cfb_input_snapshot_id bigint;

alter table public.model_predictions
  add constraint model_predictions_cfb_input_snapshot_fk
  foreign key (cfb_input_snapshot_id)
  references public.cfb_game_input_snapshots(id) on delete restrict
  not valid;

alter table public.model_predictions
  validate constraint model_predictions_cfb_input_snapshot_fk;

alter table public.model_predictions
  add constraint model_predictions_cfb_input_snapshot_league_ck check (
    cfb_input_snapshot_id is null or lower(league) = 'cfb'
  ) not valid;

alter table public.model_predictions
  validate constraint model_predictions_cfb_input_snapshot_league_ck;

create function public.guard_model_prediction_cfb_input_snapshot_insert()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  input_snapshot public.cfb_game_input_snapshots%rowtype;
begin
  if new.cfb_input_snapshot_id is null then
    return new;
  end if;

  select * into strict input_snapshot
    from public.cfb_game_input_snapshots where id = new.cfb_input_snapshot_id;

  if lower(new.league) <> 'cfb'
     or new.game_id <> input_snapshot.game_id
     or new.game_date <> input_snapshot.game_date
     or new.snapshotted_at is distinct from input_snapshot.prediction_at then
    raise exception 'model_predictions CFB input snapshot context mismatch';
  end if;
  return new;
end;
$$;

create function public.prevent_model_prediction_cfb_input_snapshot_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.cfb_input_snapshot_id is distinct from old.cfb_input_snapshot_id then
    raise exception 'model_predictions CFB input snapshot link is immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_model_prediction_cfb_input_snapshot_insert()
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_model_prediction_cfb_input_snapshot_update()
  from public, anon, authenticated, service_role;
grant execute on function public.guard_model_prediction_cfb_input_snapshot_insert() to service_role;
grant execute on function public.prevent_model_prediction_cfb_input_snapshot_update() to service_role;

create trigger model_predictions_cfb_input_snapshot_validate
before insert on public.model_predictions
for each row execute function public.guard_model_prediction_cfb_input_snapshot_insert();

create trigger model_predictions_cfb_input_snapshot_immutable
before update on public.model_predictions
for each row execute function public.prevent_model_prediction_cfb_input_snapshot_update();

commit;
