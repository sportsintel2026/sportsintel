-- WZ-RESEARCH-TABLE-2026-07-28
create table if not exists research_mlb_closing (
  id              bigserial primary key,
  odds_game_id    text        not null,
  commence_time   timestamptz not null,
  game_date       date        not null,
  home_team       text        not null,
  away_team       text        not null,
  snapshot_ts     timestamptz not null,
  bookmaker       text        not null,
  total_line      numeric     not null,
  over_price      numeric,
  under_price     numeric,
  final_home      integer,
  final_away      integer,
  mlb_game_pk     integer,
  created_at      timestamptz not null default now(),
  unique (odds_game_id, bookmaker, snapshot_ts)
);
create index if not exists idx_rmc_game_date on research_mlb_closing (game_date);
create index if not exists idx_rmc_commence  on research_mlb_closing (commence_time);
