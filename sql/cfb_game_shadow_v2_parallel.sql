begin;

-- Add only the reviewed parallel v2 identity/formula bundle. Existing rows stay
-- immutable and unchanged; v1 remains a valid, separately identified lane.
alter table public.cfb_game_shadow_predictions
  drop constraint cfb_game_shadow_predictions_model_version_check,
  drop constraint cfb_game_shadow_predictions_team_model_version_check,
  drop constraint cfb_game_shadow_predictions_experiment_version_check,
  drop constraint cfb_game_shadow_predictions_base_game_sigma_check,
  drop constraint cfb_game_shadow_uncertainty_ck;

alter table public.cfb_game_shadow_predictions
  add constraint cfb_game_shadow_model_bundle_ck check (
    (
      model_version = 'cfb-game-preseason-shadow-v1-2026'
      and team_model_version = 'cfb-preseason-prior-shadow-v1-2026'
      and experiment_version = 'cfb-game-preseason-shadow-collection-v1-2026'
      and base_game_sigma = 15.5
    )
    or
    (
      model_version = 'cfb-game-preseason-shadow-v2-2026'
      and team_model_version = 'cfb-preseason-prior-shadow-v2-2026'
      and experiment_version = 'cfb-game-preseason-shadow-v2-parallel-2026'
      and base_game_sigma = 15.5
    )
  ),
  add constraint cfb_game_shadow_uncertainty_ck check (
    abs(combined_rating_uncertainty * combined_rating_uncertainty
      - (home_team_uncertainty * home_team_uncertainty
        + away_team_uncertainty * away_team_uncertainty)) < 0.00001
    and (
      (
        model_version = 'cfb-game-preseason-shadow-v1-2026'
        and abs(predictive_sigma * predictive_sigma
          - (base_game_sigma * base_game_sigma
            + combined_rating_uncertainty * combined_rating_uncertainty)) < 0.00001
      )
      or
      (
        model_version = 'cfb-game-preseason-shadow-v2-2026'
        and abs(predictive_sigma - base_game_sigma) < 0.0000001
      )
    )
  );

comment on constraint cfb_game_shadow_model_bundle_ck
  on public.cfb_game_shadow_predictions is
  'Freezes the exact v1 and parallel-v2 model/team/experiment/sigma bundles.';

commit;
