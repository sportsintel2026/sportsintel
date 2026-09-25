-- WZ-BULLPEN-STATE-2026-07-29
create table if not exists research_bullpen_state (
  id                bigserial   primary key,
  team_id           integer     not null,
  team_name         text        not null,
  game_date         date        not null,
  season            integer     not null,
  prior_date        date        not null,
  relievers_used    integer     not null default 0,
  reliever_innings  numeric     not null default 0,
  reliever_pitches  integer     not null default 0,
  b2b_relievers     integer     not null default 0,
  rested_relievers  integer     not null default 0,
  updated_at        timestamptz not null default now(),
  unique (team_id, game_date)
);
create index if not exists idx_rbs_game_date  on research_bullpen_state (game_date);
create index if not exists idx_rbs_team_season on research_bullpen_state (team_id, season);
