# Activation Metrics Validation

Use these events to validate UX rollout impact:

- `auth_signup_completed`
- `auth_login_completed`
- `setup_step_viewed`
- `setup_step_completed`
- `setup_continue_clicked`
- `dashboard_primary_cta_clicked`

## Suggested Funnel

1. `auth_signup_completed`
2. `setup_step_completed` where `stepId=domain`
3. `setup_step_completed` where `stepId=inbox`
4. `setup_step_completed` where `stepId=contacts`
5. `setup_step_completed` where `stepId=template`
6. `setup_step_completed` where `stepId=campaign`

## Baseline vs Post-release

Track weekly before/after:

- Setup completion rate:
  - users completing all 5 setup steps / users with signup completed
- Median time to setup complete:
  - time between `auth_signup_completed` and final setup step completion
- Per-step drop-off:
  - users completing step N / users completing step N-1

