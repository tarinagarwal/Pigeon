# pigeon-admin-panel

The internal operator console for [Pigeon](../README.md) — Next.js 16, React 19,
TypeScript and Tailwind CSS v4.

A [DevsBazaar](https://devsbazaar.com) product, open sourced.

## What it does

Administration for the whole platform: users and plans, quotas and credits,
support tickets, the blog CMS, feature flags, audit logs, an error console, and
billing webhook inspection.

Two areas worth calling out:

- **Warm-up control tower** — per-inbox target versus actual engagement rates,
  reply quality scores, and close-network risk analytics with guidance on when
  to promote the pairing scorer from shadow mode to enforcing.
- **Rent & Earn administration** — marketplace users, listings, the credit
  ledger and the withdrawal payout queue.

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Authentication

Admins are a separate identity from platform users: their own collection, their
own `admin_auth_token` cookie, and JWTs carrying a `type: "admin"` claim that
user tokens can never satisfy. Two tiers exist — admin and super-admin — and
admin management is restricted to super-admins.

There is no self-service sign-up. Create the first admin with
`pigeon-backend/create_admin.py`.

> The route guard in this app is **client-side only**. Real enforcement happens
> in the FastAPI layer; treat the UI gate as convenience, not security.

## Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | FastAPI base URL, including `/api` |
| `NEXT_PUBLIC_MAIN_SITE_URL` | Public site URL, used for impersonation hand-off |
| `FRONTEND_URL` / `REVALIDATE_SECRET` | Triggers ISR cache purges on the public site |
| `CLOUDINARY_*` | Blog featured-image uploads |
