alter table public.model_predictions
  add column nfl_blend_30_prob double precision,
  add column nfl_blend_40_prob double precision,
  add column nfl_blend_50_prob double precision;

alter table public.model_predictions
  add constraint model_predictions_nfl_blend_probabilities_ck
  check (
    num_nonnulls(nfl_blend_30_prob, nfl_blend_40_prob, nfl_blend_50_prob) in (0, 3)
    and (nfl_blend_30_prob is null or nfl_blend_30_prob between 0 and 1)
    and (nfl_blend_40_prob is null or nfl_blend_40_prob between 0 and 1)
    and (nfl_blend_50_prob is null or nfl_blend_50_prob between 0 and 1)
    and (
      league is distinct from 'nfl'
      or market not in ('moneyline', 'spread', 'total')
      or experiment_version is distinct from 'nfl-blend-30-40-50-v1-2026-09-11'
      or (
        raw_win_prob is not null
        and market_fair_prob is not null
        and nfl_blend_30_prob is not null
        and nfl_blend_40_prob is not null
        and nfl_blend_50_prob is not null
        and model_prob is not null
        and edge is not null
        and abs(model_prob::double precision - nfl_blend_40_prob) <= 0.000001
        and abs(edge::double precision - (model_prob::double precision - market_fair_prob::double precision)) <= 0.000001
      )
    )
  ) not valid;

alter table public.model_predictions
  validate constraint model_predictions_nfl_blend_probabilities_ck;

create function public.prevent_nfl_blend_snapshot_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if old.league = 'nfl' and (
    new.selection is distinct from old.selection
    or new.line is distinct from old.line
    or new.odds is distinct from old.odds
    or new.opp_odds is distinct from old.opp_odds
    or new.model_prob is distinct from old.model_prob
    or new.raw_win_prob is distinct from old.raw_win_prob
    or new.market_fair_prob is distinct from old.market_fair_prob
    or new.edge is distinct from old.edge
    or new.entry_book is distinct from old.entry_book
    or new.opposing_book is distinct from old.opposing_book
    or new.model_version is distinct from old.model_version
    or new.experiment_version is distinct from old.experiment_version
    or new.nfl_blend_30_prob is distinct from old.nfl_blend_30_prob
    or new.nfl_blend_40_prob is distinct from old.nfl_blend_40_prob
    or new.nfl_blend_50_prob is distinct from old.nfl_blend_50_prob
  ) then
    raise exception 'NFL prediction-time blend snapshot is immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_nfl_blend_snapshot_update() from public;
revoke all on function public.prevent_nfl_blend_snapshot_update() from anon;
revoke all on function public.prevent_nfl_blend_snapshot_update() from authenticated;
grant execute on function public.prevent_nfl_blend_snapshot_update() to service_role;

create trigger model_predictions_nfl_blend_snapshot_immutable
before update of
  selection, line, odds, opp_odds, model_prob, raw_win_prob, market_fair_prob,
  edge, entry_book, opposing_book, model_version, experiment_version,
  nfl_blend_30_prob, nfl_blend_40_prob, nfl_blend_50_prob
on public.model_predictions
for each row execute function public.prevent_nfl_blend_snapshot_update();
