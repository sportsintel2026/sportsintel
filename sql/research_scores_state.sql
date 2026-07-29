-- WZ-SCORES-STATE-2026-07-28
create table if not exists research_scores_state (
  id                  integer primary key default 1,
  last_processed_date date not null,
  updated_at          timestamptz not null default now(),
  constraint single_row check (id = 1)
);
insert into research_scores_state (id, last_processed_date)
values (1, '2020-07-22')
on conflict (id) do nothing;
