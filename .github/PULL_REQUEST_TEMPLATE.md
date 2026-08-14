# Pull request

## What this changes

<!-- A short summary of the change. What is different after this is merged? -->

## Why

<!-- The problem this solves, and the reasoning behind this approach. Link any related issue,
     e.g. "Closes #123". -->

Closes #

## Type of change

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `refactor` — behaviour-preserving restructure
- [ ] `docs` — documentation only
- [ ] `test` — tests only
- [ ] `chore` / `ci` — tooling, dependencies, pipelines
- [ ] Breaking change (requires a migration, an env var change, or manual action on deploy)

## Area affected

- [ ] Backend API (`pigeon-backend`)
- [ ] Marketing site (`pigeon-frontend-next`)
- [ ] Dashboard / app (`pigeon-frontend-next`)
- [ ] Admin panel (`pigeon-admin-panel`)
- [ ] Rent & Earn
- [ ] Infrastructure (`infrastructure/`, Docker, CI)
- [ ] Documentation

## Testing done

- [ ] `pytest` passes in `pigeon-backend`
- [ ] `npx tsc --noEmit` passes in `pigeon-frontend-next`
- [ ] `npx tsc --noEmit` passes in `pigeon-admin-panel` (if the admin panel was touched)
- [ ] Verified manually against a running `docker compose up --build` stack

> `next dev` does not typecheck. A page can look perfect locally and still break the production
> build, so please run `npx tsc --noEmit` even for changes that seem cosmetic.

<!-- Describe what you actually exercised: which flows, which edge cases, any new tests added. -->

## Screenshots

<!-- Required for UI changes. Before/after is ideal, and both light and dark themes if the change
     is visual. Delete this section for backend-only changes. -->

## Checklist

- [ ] No secrets or `.env` files are included — no API keys, tokens, JWTs, `ENCRYPTION_KEY`,
      passwords, or real customer data in the diff, description, logs, or screenshots
- [ ] Docs updated if behaviour changed (README, `CONTRIBUTING.md`, or in-app copy)
- [ ] Any new configuration variable is documented in the relevant `.env.example`
- [ ] Commits follow Conventional Commits (`feat(backend): …`, `fix(web): …`)
- [ ] The change is focused on one concern
- [ ] I have read the [Contributing guide](../CONTRIBUTING.md) and agree to the
      [Code of Conduct](../CODE_OF_CONDUCT.md)

## Notes for reviewers

<!-- Anything worth flagging: trade-offs, follow-up work, areas you would like a closer look at,
     or migration steps needed on deploy. -->
