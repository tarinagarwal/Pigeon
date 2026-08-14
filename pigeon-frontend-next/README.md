# pigeon-frontend-next

The public site and authenticated app for [Pigeon](../README.md) — Next.js 16,
React 19, TypeScript and Tailwind CSS v4.

A [DevsBazaar](https://devsbazaar.com) product, open sourced.

## What lives here

| Route group | Purpose |
| --- | --- |
| `app/(marketing)/` | Public site — home, features, pricing, contact |
| `app/(auth)/` | Sign in, password reset, email verification |
| `app/(app)/` | Authenticated dashboard — campaigns, contacts, inbox, warm-up, workflows, analytics, settings |
| `app/rent/` | Rent & Earn marketplace portal (its own auth realm) |
| `app/mailbox/` | Standalone webmail for provisioned mailbox owners |
| `app/api/` | Server-side proxies, blog and plan endpoints, tracking redirects |

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Runs on http://localhost:3000 and expects the API at `NEXT_PUBLIC_API_URL`.

> `next dev` does **not** run type checking. Always run `npx tsc --noEmit`
> before pushing — a page can render perfectly in dev and still fail the
> production build.

## Design system

Soft brutalism: thick 3px borders, solid offset shadows, generous rounded
corners, and a warm pastel palette on a near-black-and-ember base. Display type
is Rubik, body is Space Grotesk, both self-hosted through `next/font`.

Colour tokens live in `app/globals.css` as HSL triples. Always style through the
tokens (`bg-primary`, `text-foreground`, `hsl(var(--sb-peach))`) rather than
hardcoding hex values, so both themes stay consistent.

## Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | FastAPI base URL, including `/api` |
| `NEXT_PUBLIC_SITE_URL` | Canonical public URL, used for SEO and sitemaps |
| `MONGO_URL` / `DB_NAME` | Direct reads for blog and plan pages during SSR |
| `REVALIDATE_SECRET` | Shared secret for on-demand ISR revalidation |
| `CLOUDINARY_*` | Image uploads from the template builder |

`NEXT_PUBLIC_*` values are baked in at **build** time, so changing them requires
a rebuild, not just a restart.
