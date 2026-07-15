create table if not exists public.sharp_edge_snapshots (
  id                  bigint generated always as identity primary key,
  captured_at         timestamptz not null default now(),
  sport               text        not null default 'baseball_mlb',
  game                text        not null,
  commence            timestamptz,
  delta_away_pp       real,
  pin_fair_away_pct   real,
  pin_fair_home_pct   real,
  pin_raw             text,
  model_fair_away_pct real,
  model_fair_home_pct real,
  model_best_line     text,
  model_books         jsonb
);

create index if not exists sharp_edge_snapshots_latest_idx
  on public.sharp_edge_snapshots (sport, captured_at desc);

create index if not exists sharp_edge_snapshots_game_idx
  on public.sharp_edge_snapshots (game, captured_at desc);
