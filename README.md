[![Scanned with LGTM Security](https://api.looksgoodtomeow.in/security/banner/6a7e8a773406544f615c2db0.svg?theme=dark)](https://app.looksgoodtomeow.in/dashboard/security/6a7e8a773406544f615c2db0)

<div align="center">

<img src="pigeon-frontend-next/public/pigeon-mark.png" alt="Pigeon" width="180" />

# Pigeon

**Open-source cold email outreach and deliverability platform.**

Build contact lists, run multi-step campaigns across mailboxes you already own,
warm them up so providers trust them, and track every open, click and reply —
with billing, an operator console and infrastructure-as-code included.

[![License: MIT](https://img.shields.io/badge/License-MIT-C2410C.svg)](LICENSE)
[![Python 3.12](https://img.shields.io/badge/Python-3.12-1A1512.svg)](https://www.python.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-1A1512.svg)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.135-1A1512.svg)](https://fastapi.tiangolo.com/)

**A [DevsBazaar](https://devsbazaar.com) product — open sourced.**

[Live site](https://pigeon.tarinagarwal.in) ·
[Architecture](ARCHITECTURE.md) ·
[Contributing](CONTRIBUTING.md) ·
[Security](SECURITY.md)

</div>

---

## Why Pigeon exists

Cold outreach tools charge per seat and per inbox, then cap how much you can
send. Pigeon inverts that: you connect **your own** mailboxes, you own the data,
and there are no limits imposed by the platform. Run it hosted, or clone the
repository and self-host the entire stack — every feature is in here.

---

## Contents

| Path | Stack | What it is |
| --- | --- | --- |
| `pigeon-backend/` | FastAPI · Python 3.12 | The whole API — 435 endpoint handlers across 45 route modules and 47 services |
| `pigeon-frontend-next/` | Next.js 16 · React 19 · TS | Marketing site, authenticated dashboard, Rent & Earn portal, webmail |
| `pigeon-admin-panel/` | Next.js 16 · React 19 · TS | Internal operator console |
| `infrastructure/` | Terraform · Caddy | Cloud provisioning and the TLS reverse proxy |
| `docker-compose.yml` | Docker | Runs the entire stack, MongoDB included |

---

## Features

### Campaigns and sending

- **Multi-step sequences** — chain follow-ups with independent per-step delays;
  they stop automatically the moment someone replies, bounces or unsubscribes.
- **A/B testing with an auto-selected winner** — run template variants inside a
  single step. The winner is scored **60% on reply rate, 40% on open rate**,
  with a re-evaluation throttle so it does not flip-flop.
- **Inbox rotation** — spread volume across many senders, round-robin or random,
  mixing Gmail and SMTP mailboxes in one campaign.
- **Scheduling** — start date, send window, timezone and permitted weekdays
  (Monday–Friday by default).
- **Three layers of volume control** — a campaign daily cap, a per-inbox cap
  hard-limited to 50/day by a validator no plan can override, and a ramp-up tier
  that scales an inbox's allowance with its age.
- **Human-like pacing** — randomised gaps between sends, plus a per-inbox weekly
  rhythm that gives each mailbox its own quieter days.
- **Nested spintax** — `{a|b|c}` with `{{variables}}` inside them, resolved over
  multiple passes.
- **Reply-To routing** — none, a Gmail account, a separate IMAP mailbox, or an
  arbitrary custom address.

### Deliverability and warm-up

- **Mailbox warm-up** — multi-turn threaded conversations with correct
  `In-Reply-To` and `References` headers, so a mailbox's history looks like real
  correspondence rather than isolated pings.
- **Automatic spam rescue** — the receiver loop opens messages, marks them
  important and moves them out of the spam folder.
- **Pairing risk scoring** — before pairing a sender with a receiver, Pigeon
  scores how artificial that pairing would look to a mailbox provider, weighting
  recent pair reuse (0.45), a reciprocity cap (0.20), provider concentration
  (0.20) and domain concentration (0.15). It runs in `off`, `shadow`,
  `high_confidence` or `full` mode and **ships in `shadow`** — recording what it
  *would* have blocked without blocking anything, so you can promote it on
  evidence rather than faith.
- **Realistic engagement** — every inbox is assigned randomised target open and
  reply rates between 30% and 50% at midnight UTC, avoiding the
  100%-engagement signature of naive warm-up tools.
- **DNS automation** — SPF, DKIM and DMARC records written straight to
  **Cloudflare, GoDaddy, Namecheap or Google Cloud DNS** using stored (encrypted)
  credentials, instead of making you copy-paste them.
- **Verification and health scoring** — SPF/DKIM/DMARC/MX checked both through
  the provider API and by direct DNS lookup, rolled into a 0–100 domain score.
- **Inbox placement testing** — seed sends through real Gmail and Outlook
  accounts classify a campaign as inbox, spam or promotions, per domain and
  subdomain, re-checked on a schedule.
- **Custom tracking domains** — serve open pixels and click links from your own
  branded subdomain, with TLS certificates issued on demand.

### AI and lead generation

- **Per-recipient AI writing** — copy generated at send time rather than merge
  tags, using **your own** OpenAI, Anthropic, Gemini, DeepSeek, Grok or Groq key.
- **Web enrichment** — optionally search the lead through Serper, read linked
  pages, extract phone numbers and personalise the template from what it finds.
- **AI Campaign Studio** — a chat interface that builds real campaigns: it
  classifies intent, then creates templates, picks contact lists and inboxes, and
  launches campaigns against live data.
- **Smart Leads** — an async discovery pipeline: an LLM writes search queries →
  Serper runs them → pages are scraped → an LLM extracts companies and people →
  email patterns are guessed → ZeroBounce validates them.
- **Risky contact removal** — bulk verification strips undeliverable addresses,
  and contacts are auto-blocked after three sends with no engagement or three
  failed deliveries, then purged after a retention window.

### Inbox, automation and insight

- **Unified inbox** — every reply across every connected mailbox in one threaded
  view, captured through the Gmail API, IMAP polling or SendGrid inbound parse,
  and classified by origin (human, auto-responder, or your own outbound).
- **AI-drafted replies** and a rich-text editor, with ETag/304 responses keeping
  polling cheap.
- **Workflow automation** — a visual node-and-edge canvas. Triggers on campaign
  start, send, open, reply or cron; nodes for conditions, waits, list changes and
  campaign control; full run history with per-step status and retry counts.
- **Lifecycle drip** — a separate trial-to-paid email track with cycle-safe
  idempotency keys, so a renewal can never double-send.
- **Analytics** — opens, clicks and replies sliced by campaign, inbox and hour of
  day, plus best-send-time and sending-behaviour insight.

### Platform

- **Rent & Earn marketplace** — a two-sided marketplace where members list
  mailboxes they own and earn credits when those addresses receive warm-up mail.
  Earnings sit under a **48-hour hold** and settle on reply detection, or refund
  the sender when there was no engagement. Withdrawals go to bank or UPI above a
  500-credit minimum.
- **Teams** — sub-users with page-level permissions across twelve areas, using a
  workspace-context header so every handler transparently serves the owner's
  data.
- **Billing** — Razorpay for India and Lemon Squeezy internationally, selected by
  IP region, with HMAC-verified webhooks stored with a `signature_valid` flag for
  audit.
- **Admin console** — 131 endpoints covering users, plans, quotas, warm-up
  operations, marketplace administration, feature flags, audit logs and an error
  console.
- **Support bot** — retrieval-augmented answers over the documentation corpus
  using ChromaDB with sentence-transformers embeddings and Groq for generation.

---

## Quick start (Docker)

Requires Docker with the Compose plugin.

```bash
# 1. Compose-level knobs (ports, Mongo URL, public URLs)
cp .env.example .env

# 2. Per-service secrets — fill in your own credentials
cp pigeon-backend/.env.example        pigeon-backend/.env
cp pigeon-frontend-next/.env.example  pigeon-frontend-next/.env.local
cp pigeon-admin-panel/.env.example    pigeon-admin-panel/.env.local

# 3. Build and run everything, MongoDB included
docker compose up --build
```

| Service | URL |
| --- | --- |
| Frontend | http://localhost:8080 |
| Admin panel | http://localhost:8082 |
| API | http://localhost:8001/api |
| Health check | http://localhost:8001/api/health |

### Minimum configuration

Only four variables are genuinely required:

```env
MONGO_URL=mongodb://mongo:27017
DB_NAME=pigeon
JWT_SECRET=<a long random string>
ENCRYPTION_KEY=<Fernet key, generated below>
```

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

> ⚠️ **Back up `ENCRYPTION_KEY`.** It is the Fernet key protecting every stored
> SMTP password, Gmail app password, IMAP credential and DNS provider key. Lose
> it and every connected mailbox becomes unrecoverable — there is no reset path.

Everything else in `pigeon-backend/.env.example` is optional and only needed for
the matching integration. To actually deliver verification and 2FA email you
will need either `SENDGRID_API_KEY` or the `NOTIFICATION_SMTP_*` variables.

---

## Local development

**Backend** — Python 3.12+, with MongoDB running locally:

```bash
cd pigeon-backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn server:app --reload --port 8001
pytest
```

**Frontend / admin** — Node 20+:

```bash
cd pigeon-frontend-next   # or pigeon-admin-panel
npm install
cp .env.example .env.local
npm run dev
npx tsc --noEmit          # next dev does NOT typecheck — run this before pushing
```

---

## Deployment

The stack runs anywhere Docker does — the simplest production setup is a single
VM running `docker compose`, with Caddy terminating TLS in front of the three
services and MongoDB Atlas for data.

`infrastructure/terraform/` holds an optional, more elaborate AWS topology
(EC2 in an Auto Scaling Group behind an ALB, ECR, an IAM instance role and a
termination lifecycle hook) for running the backend at scale. It is not required
for a single-VM deployment. `infrastructure/caddy/` holds the reverse-proxy
configuration, including on-demand certificate issuance for customer-owned
tracking domains.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full topology, the background
worker model and the integration map.

---

## Contributing

Issues and pull requests are welcome — start with
[CONTRIBUTING.md](CONTRIBUTING.md). Please report security vulnerabilities
privately as described in [SECURITY.md](SECURITY.md) rather than in a public
issue.

Questions, ideas or commercial enquiries: **tarinagarwal@gmail.com**

---

## License

[MIT](LICENSE) — use it, fork it, sell it. No licence fee, no seat limits.

<div align="center">

Built and open sourced by **[DevsBazaar](https://devsbazaar.com)**

</div>
