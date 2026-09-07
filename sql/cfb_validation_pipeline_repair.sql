begin;

do $$
declare
  current_guard text;
begin
  if to_regclass('public.cfb_game_control_benchmark_links') is null
     or to_regclass('public.cfb_game_shadow_predictions') is null
     or to_regclass('public.cfb_game_input_snapshots') is null
     or to_regclass('public.model_predictions') is null then
    raise exception 'required active CFB validation tables are missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'cfb_game_control_benchmark_link_validate'
      and tgrelid = 'public.cfb_game_control_benchmark_links'::regclass
      and not tgisinternal
  ) then
    raise exception 'active CFB benchmark validation trigger is missing';
  end if;
  select pg_get_functiondef('public.guard_cfb_game_control_benchmark_link_insert()'::regprocedure)
    into current_guard;
  if position('fixed_row.matchup <> shadow_row.away_team_name' in current_guard) = 0
     or position('homeEspnTeamId' in current_guard) = 0
     or position('awayEspnTeamId' in current_guard) = 0 then
    raise exception 'active CFB benchmark guard differs from the reviewed pre-repair definition';
  end if;
end;
$$;

create or replace function public.guard_cfb_game_control_benchmark_link_insert()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  shadow_row public.cfb_game_shadow_predictions%rowtype;
  input_row public.cfb_game_input_snapshots%rowtype;
  fixed_row public.model_predictions%rowtype;
  selected_row public.model_predictions%rowtype;
  expected_fixed_market text;
  expected_selected_side text;
  expected_week smallint;
  expected_model_prob numeric;
  expected_raw_prob numeric;
  expected_market_fair numeric;
  expected_edge numeric;
  expected_line numeric;
  expected_odds integer;
  expected_opp_odds integer;
  expected_book text;
  expected_opposing_book text;
  expected_delta double precision;
begin
  select * into strict shadow_row
    from public.cfb_game_shadow_predictions where id = new.shadow_prediction_id;
  select * into strict input_row
    from public.cfb_game_input_snapshots where id = shadow_row.input_snapshot_id;
  select * into strict fixed_row
    from public.model_predictions where id = new.control_fixed_prediction_id;

  expected_fixed_market := new.market || '_shadow';
  expected_selected_side := case when fixed_row.model_prob >= 0.5 then 'home' else 'away' end;
  expected_week := nullif(input_row.game_context->>'week', '')::smallint;
  expected_delta := extract(epoch from (fixed_row.snapshotted_at - shadow_row.prediction_at));

  if shadow_row.model_version <> 'cfb-game-preseason-shadow-v1-2026'
     or fixed_row.league <> 'cfb'
     or fixed_row.market <> expected_fixed_market
     or fixed_row.selection <> 'home'
     or fixed_row.model_version <> (case new.market
       when 'moneyline' then 'cfb-moneyline-v1-2026-08-30'
       else 'cfb-spread-v1-2026-08-30'
     end)
     or fixed_row.experiment_version <> 'cfb-side-edge-provenance-v1-2026-08-30'
     or fixed_row.game_id is distinct from shadow_row.game_id
     or input_row.game_id is distinct from shadow_row.game_id
     or input_row.game_context->>'homeEspnTeamId' is distinct from shadow_row.home_espn_team_id
     or input_row.game_context->>'awayEspnTeamId' is distinct from shadow_row.away_espn_team_id then
    raise exception 'CFB control benchmark game/model identity mismatch';
  end if;

  if new.game_id <> shadow_row.game_id
     or new.season <> shadow_row.season
     or new.week is distinct from expected_week
     or new.home_espn_team_id <> shadow_row.home_espn_team_id
     or new.away_espn_team_id <> shadow_row.away_espn_team_id
     or new.home_team_name <> shadow_row.home_team_name
     or new.away_team_name <> shadow_row.away_team_name
     or new.neutral_site_status <> shadow_row.neutral_site_status
     or new.kickoff_at <> shadow_row.kickoff_at
     or new.control_prediction_at <> fixed_row.snapshotted_at
     or new.shadow_prediction_at <> shadow_row.prediction_at
     or new.control_market_quote_at <> shadow_row.market_quote_at
     or fixed_row.snapshotted_at <> shadow_row.prediction_at
     or shadow_row.market_quote_at <> shadow_row.prediction_at
     or abs(new.control_shadow_time_delta_seconds - expected_delta) >= 0.001
     or abs(expected_delta) > 300
     or new.control_selected_side <> expected_selected_side then
    raise exception 'CFB control benchmark copied identity/timing mismatch';
  end if;

  if new.market = 'moneyline' then
    if fixed_row.odds is distinct from shadow_row.home_ml_odds
       or fixed_row.opp_odds is distinct from shadow_row.away_ml_odds
       or fixed_row.entry_book is distinct from shadow_row.home_ml_book
       or fixed_row.opposing_book is distinct from shadow_row.away_ml_book
       or abs(fixed_row.market_fair_prob::double precision
         - round(shadow_row.market_fair_home_win_probability::numeric, 3)::double precision) >= 0.0000001 then
      raise exception 'CFB control benchmark moneyline context mismatch';
    end if;
  else
    if fixed_row.line is distinct from shadow_row.home_spread::numeric
       or fixed_row.odds is distinct from shadow_row.home_spread_odds
       or fixed_row.opp_odds is distinct from shadow_row.away_spread_odds
       or fixed_row.entry_book is distinct from shadow_row.home_spread_book
       or fixed_row.opposing_book is distinct from shadow_row.away_spread_book
       or abs(fixed_row.market_fair_prob::double precision
         - round(shadow_row.market_fair_home_cover_probability::numeric, 3)::double precision) >= 0.0000001 then
      raise exception 'CFB control benchmark spread context mismatch';
    end if;
  end if;

  if fixed_row.data_quality = 'rated' then
    if new.control_state <> 'RATED_CONTROL' or new.control_selected_prediction_id is null then
      raise exception 'rated CFB control benchmark state mismatch';
    end if;
    select * into strict selected_row
      from public.model_predictions where id = new.control_selected_prediction_id;

    expected_model_prob := case when expected_selected_side = 'home'
      then fixed_row.model_prob else round(1 - fixed_row.model_prob, 3) end;
    expected_raw_prob := case when expected_selected_side = 'home'
      then fixed_row.raw_win_prob else round(1 - fixed_row.raw_win_prob, 3) end;
    expected_market_fair := case when expected_selected_side = 'home'
      then fixed_row.market_fair_prob else round(1 - fixed_row.market_fair_prob, 3) end;
    expected_edge := case when expected_selected_side = 'home'
      then fixed_row.edge else round(-fixed_row.edge, 3) end;
    expected_line := case
      when new.market = 'moneyline' then null
      when expected_selected_side = 'home' then fixed_row.line
      else -fixed_row.line
    end;
    expected_odds := case when expected_selected_side = 'home' then fixed_row.odds else fixed_row.opp_odds end;
    expected_opp_odds := case when expected_selected_side = 'home' then fixed_row.opp_odds else fixed_row.odds end;
    expected_book := case when expected_selected_side = 'home' then fixed_row.entry_book else fixed_row.opposing_book end;
    expected_opposing_book := case when expected_selected_side = 'home' then fixed_row.opposing_book else fixed_row.entry_book end;

    if selected_row.league <> 'cfb'
       or selected_row.game_id <> fixed_row.game_id
       or selected_row.matchup <> fixed_row.matchup
       or selected_row.market <> new.market
       or selected_row.selection <> expected_selected_side
       or selected_row.snapshotted_at <> fixed_row.snapshotted_at
       or selected_row.model_version <> fixed_row.model_version
       or selected_row.experiment_version <> fixed_row.experiment_version
       or selected_row.data_quality <> 'rated'
       or selected_row.model_prob is distinct from expected_model_prob
       or selected_row.raw_win_prob is distinct from expected_raw_prob
       or selected_row.market_fair_prob is distinct from expected_market_fair
       or selected_row.edge is distinct from expected_edge
       or selected_row.line is distinct from expected_line
       or selected_row.odds is distinct from expected_odds
       or selected_row.opp_odds is distinct from expected_opp_odds
       or selected_row.entry_book is distinct from expected_book
       or selected_row.opposing_book is distinct from expected_opposing_book then
      raise exception 'CFB rated selected control row mismatch';
    end if;
  elsif fixed_row.data_quality = 'market-only' then
    if new.control_state <> 'MARKET_ONLY_CONTROL'
       or new.control_selected_prediction_id is not null
       or fixed_row.raw_win_prob is not null
       or fixed_row.edge is not null
       or fixed_row.model_prob is distinct from fixed_row.market_fair_prob then
      raise exception 'CFB market-only control benchmark semantics mismatch';
    end if;
  elsif fixed_row.data_quality = 'suspect' then
    if new.control_state <> 'INELIGIBLE_CONTROL'
       or new.control_selected_prediction_id is not null then
      raise exception 'CFB ineligible control benchmark state mismatch';
    end if;
  else
    raise exception 'unsupported CFB control benchmark data quality';
  end if;
  return new;
end;
$$;

commit;
