# Contributing to Pigeon

Thanks for taking an interest in Pigeon. Whether you are fixing a typo, tightening a deliverability
heuristic, or adding a whole integration, contributions are genuinely welcome.

Pigeon is an open-source cold email outreach and deliverability platform. It is a
[DevsBazaar](https://devsbazaar.com) product, open sourced under the MIT licence, and developed in
the open at <https://github.com/tarinagarwal/Pigeon>. The hosted instance runs at
<https://pigeon.tarinagarwal.in>.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Prerequisites

Either of these will get you running:

- **Docker** with the Compose plugin (`docker compose`, not the old `docker-compose`) — the
  recommended path, and the one CI and production use.
- **Python 3.12 and Node 20** if you would rather run the services directly on your machine. These
  are the versions the Dockerfiles pin, so they are the versions we can support.

You will also need a MongoDB instance. Docker Compose brings its own; for local dev without Docker,
run Mongo yourself or point at a managed cluster such as Atlas.

---

## Quick start with Docker

```bash
git clone https://github.com/tarinagarwal/Pigeon.git
cd Pigeon

cp .env.example .env
cp pigeon-backend/.env.example pigeon-backend/.env
cp pigeon-frontend-next/.env.example pigeon-frontend-next/.env.local
cp pigeon-admin-panel/.env.example pigeon-admin-panel/.env.local

docker compose up --build
```

Fill in at least the required variables (see below) in `pigeon-backend/.env` before the stack will
do anything useful.

Once it is up:

| Service           | URL                              |
| ----------------- | -------------------------------- |
| Frontend (site + app) | <http://localhost:8080>      |
| Admin panel       | <http://localhost:8082>          |
| Backend API       | <http://localhost:8001/api>      |
| Health check      | <http://localhost:8001/api/health> |
| MongoDB           | internal only, as `mongo:27017`  |

Host ports are configurable via `BACKEND_PORT`, `FRONTEND_PORT`, and `ADMIN_PORT` in the root
`.env`. The container ports are fixed in `docker-compose.yml`.

Note that `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SITE_URL` are baked into the Next.js images at
**build** time. If you change them, rebuild (`docker compose up --build`) rather than just
restarting.

---

## Local development without Docker

### Backend

```bash
cd pigeon-backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # then fill in the required vars
uvicorn server:app --reload --port 8001
```

The API is then at <http://localhost:8001/api>.

`requirements.txt` includes the retrieval-augmented support bot dependencies
(`chromadb`, `sentence-transformers`), which pull in PyTorch and are large. On a first install,
expect it to take a while.

### Frontend

```bash
cd pigeon-frontend-next
npm install
cp .env.example .env.local
npm run dev
```

### Admin panel

```bash
cd pigeon-admin-panel
npm install
cp .env.example .env.local
npm run dev
```

Both Next.js apps default to port 3000 in dev, so run them one at a time or pass `-p` to move one
of them. Point `NEXT_PUBLIC_API_URL` at your running backend (`http://localhost:8001/api`).

---

## Required environment variables

You only need four variables to boot the backend. Everything else in
`pigeon-backend/.env.example` is per-integration and optional — add a provider's keys when you want
to work on that provider.

| Variable         | Purpose                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `MONGO_URL`      | MongoDB connection string (`mongodb://mongo:27017` under Compose)     |
| `DB_NAME`        | Database name (`pigeon_ai` by default)                                |
| `JWT_SECRET`     | Signing secret for app and admin JWTs. Use a long random value.       |
| `ENCRYPTION_KEY` | Fernet key used to encrypt stored mailbox and provider credentials    |

Generate a Fernet key with:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Keep this key safe. Losing it makes every stored mailbox credential permanently unrecoverable —
see [SECURITY.md](SECURITY.md).

Everything else — Google and Microsoft OAuth, SendGrid, Slack, Groq, Serper, Razorpay, Lemon
Squeezy, Cloudinary, AWS — is only needed for the feature it powers. Features whose keys are absent
will simply be unavailable locally.

---

## Project structure

```
.
├── pigeon-backend/          FastAPI service (Python 3.12)
│   ├── server.py            App entrypoint — `uvicorn server:app`
│   ├── models.py            Pydantic domain models
│   ├── admin_models.py      Admin-side models
│   ├── database.py          Mongo (Motor) connection layer
│   ├── config.py            Shared constants and retention knobs
│   ├── routes/              API routers: auth, campaigns, contacts, domains,
│   │                        inboxes, warmup, billing, rent_network, admin_*, …
│   ├── services/            Business logic: SMTP/IMAP, warm-up engine, tracking,
│   │                        billing providers, LLM, encryption, support bot
│   ├── scripts/             One-off maintenance and migration scripts
│   └── tests/               pytest suite
│
├── pigeon-frontend-next/    Next.js 16 + React 19 + TypeScript + Tailwind v4
│   └── app/
│       ├── (marketing)/     Public marketing site
│       ├── (auth)/          Sign-in / sign-up
│       ├── (app)/           The authenticated dashboard
│       ├── mailbox/         Standalone webmail client
│       ├── rent/            Rent & Earn portal
│       └── api/             Next route handlers, incl. the backend proxy
│
├── pigeon-admin-panel/      Next.js operator console (users, plans, billing,
│                            warm-up control tower, infrastructure controls)
│
├── infrastructure/          Terraform (AWS) and Caddy on-demand TLS proxy
│
├── docker-compose.yml       Full local/self-hosted stack
└── .github/workflows/       CI — backend image build and ASG deploy
```

---

## Before opening a pull request

Run both checks. They are quick and they catch most of what reviewers would otherwise catch.

**Backend tests:**

```bash
cd pigeon-backend
pytest
```

**Frontend typecheck:**

```bash
cd pigeon-frontend-next
npx tsc --noEmit
```

Run the same typecheck in `pigeon-admin-panel` if you touched it.

> **Please do not skip the typecheck.** `next dev` does *not* typecheck your code — it transpiles.
> A page can render perfectly in dev and still fail `next build` with a type error, which means a
> broken production build and a broken deploy. `npx tsc --noEmit` is the only thing standing
> between a clean dev session and a red pipeline.

Linting is available via `npm run lint` in either Next.js app if you want it.

---

## Commit convention

We use [Conventional Commits](https://www.conventionalcommits.org/), matching the existing history:

```
<type>(<scope>): <short imperative summary>
```

**Types:** `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`

**Scopes:** `backend`, `web`, `admin`, `infra` — the scope is optional for changes that span the
whole repo.

Real examples from this repository:

```
feat(backend): warm-up engine with pairing risk scoring
feat(web): campaign builder and sequence editor
feat(admin): operator console — users, plans and billing
feat(infra): Terraform for AWS and Caddy on-demand TLS proxy
test(backend): unit tests for billing idempotency and warm-up safety
ci: container build and deployment workflow
chore: drop unused source artwork from repo root
```

Keep the summary in the imperative mood, lower case after the colon, and under about 72 characters.
Put the reasoning in the body if it needs one.

---

## Pull request guidance

- **Open an issue first** for anything substantial. It saves you building something we would want
  built differently.
- **Keep pull requests focused.** One concern per PR reviews far faster than a mixed bag.
- **Never include secrets.** No `.env` files, API keys, tokens, real customer data, or production
  logs — in the diff, the description, or the screenshots. Redact before you paste.
- **Update the docs** when behaviour changes, including the relevant `.env.example` if you add a
  configuration variable. A new env var with no `.env.example` entry is an undiscoverable feature.
- **Include screenshots** for anything that changes the UI, ideally in both light and dark themes.
- Fill in the pull request template — it exists to make review quick, not to be tedious.

---

## Reporting bugs and requesting features

Use the issue forms in [`.github/ISSUE_TEMPLATE`](.github/ISSUE_TEMPLATE). Please redact secrets
from any logs you attach.

## Security issues

**Do not open a public issue for a security vulnerability.** Email tarinagarwal@gmail.com privately
instead. See [SECURITY.md](SECURITY.md) for what to include and what to expect.

## Licence

By contributing, you agree that your contributions are licensed under the MIT Licence, the same
terms as the project.

## Contact

Questions that do not fit an issue? Email tarinagarwal@gmail.com.
