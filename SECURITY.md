# Security Policy

Pigeon is an open-source cold email outreach and deliverability platform, and a
[DevsBazaar](https://devsbazaar.com) product. Because it stores mailbox credentials and sends
mail on behalf of its users, we take security reports seriously and would rather hear about a
problem early than read about it later.

## Supported versions

Pigeon has no tagged releases. There is a single supported line: the latest commit on `main`.

Security fixes land on `main` and are rolled out to the hosted instance at
<https://pigeon.tarinagarwal.in>. If you self-host, track `main` and rebuild
(`docker compose up --build`) to pick up fixes. Older checkouts receive no backports.

## Reporting a vulnerability

**Please do not open a public GitHub issue, discussion, or pull request for a security problem.**

Email **tarinagarwal@gmail.com** with the subject line prefixed `[Pigeon Security]`.

Include as much of the following as you can:

- A description of the issue and the impact you believe it has
- The component involved: backend API, marketing site, dashboard, admin panel, Rent & Earn, or
  deployment/infrastructure
- Steps to reproduce, ideally a minimal proof of concept
- The commit SHA you tested against, and whether it was self-hosted or the hosted instance
- Any logs or request/response captures — with credentials, tokens, and personal data redacted

Please do not test against the hosted instance in ways that degrade service for others, access
data belonging to other users, or send mail to third parties. A local `docker compose` stack is
the right place to prove out an exploit.

### What to expect

- **Acknowledgement:** best effort within 3 business days. This is a small project, so if you
  have not heard back after that, a polite follow-up email is welcome.
- **Assessment:** we will confirm the report, agree on severity with you, and tell you whether we
  intend to fix it, and roughly when.
- **Fix and disclosure:** we ask that you keep the report private until a fix is on `main`. We aim
  to resolve serious issues within 90 days of acknowledgement. Once a fix has shipped, we are happy
  to credit you in the commit or release notes — tell us how you would like to be named, or if you
  would rather stay anonymous.
- **Out of scope:** reports that amount to missing hardening headers with no demonstrated impact,
  automated scanner output without a working proof of concept, social engineering, denial of
  service by brute traffic volume, and issues in third-party services (Google, Microsoft, SendGrid,
  Razorpay, Lemon Squeezy, AWS) that are not caused by Pigeon's use of them.

There is no bug bounty. This is an open-source project maintained without a security budget.

## Security model

### What Pigeon does for you

- **Credentials at rest are encrypted.** SMTP and IMAP passwords, Gmail app passwords, Google OAuth
  client secrets, and DNS provider API secrets are encrypted with
  [Fernet](https://cryptography.io/en/latest/fernet/) (`cryptography`) using the `ENCRYPTION_KEY`
  from the environment, and are never returned by the API — the read paths project them out of the
  response.
- **User passwords are bcrypt-hashed** via `passlib`, never stored or logged in plain text.
- **Authentication uses JWTs** signed with `JWT_SECRET`, shared by the app and the admin panel.
- **The backend container runs as a non-root user** and MongoDB is not published to the host by
  default in `docker-compose.yml` — it is reachable only on the internal compose network.

### What you are responsible for when self-hosting

Pigeon cannot protect a deployment that is configured insecurely. If you run your own instance,
these are on you:

- **Set a strong, unique `JWT_SECRET`.** The value in `.env.example` is a placeholder. Anyone who
  learns your `JWT_SECRET` can mint tokens for any account, including admin accounts.
- **Generate your own `ENCRYPTION_KEY`** and never reuse one across environments:

  ```bash
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  ```

  **If you lose `ENCRYPTION_KEY`, every stored mailbox credential becomes permanently
  unrecoverable.** There is no escrow and no recovery path — users would have to re-enter every
  SMTP/IMAP password, app password, and provider secret. Back it up somewhere durable and separate
  from the database, and treat rotating it as a migration, not a config change.
- **Keep `.env` files out of version control.** The repository's `.gitignore` already excludes
  `.env`, `.env.*`, `*.pem`, `*.key`, and `*.tfvars`; do not force-add them, and do not paste their
  contents into issues, pull requests, or bug reports.
- **Scope the MongoDB user.** Create a dedicated user with read/write access to the Pigeon database
  only — not `root`, not cluster-wide. Never expose MongoDB to the public internet; keep it on a
  private network or restrict it by IP.
- **Restrict SSH to your servers.** Key-based authentication only, no password login, no root
  login, and limit port 22 to known source addresses in your security groups. The Terraform in
  `infrastructure/` is a starting point, not a hardened baseline — review it before applying.
- **Terminate TLS and set `COOKIE_SECURE=true` in production**, so the auth cookie is only ever
  sent over HTTPS. The Caddy configuration in `infrastructure/caddy/` handles certificates for the
  tracking domain setup.
- **Rotate provider credentials** (Google, Microsoft, SendGrid, Slack, Razorpay, Lemon Squeezy,
  AWS) on your usual schedule, and grant each the narrowest scope that works.
- **Keep `ALLOW_DEV_CREATE_ADMIN` unset in production.** It exists for local bootstrapping only.

### Responsible sending

Pigeon sends email. Running it does not exempt you from anti-spam law — CAN-SPAM, GDPR, PECR, and
your mail provider's terms still apply. Send only to contacts you have a lawful basis to contact,
honour unsubscribes, and do not use the platform for phishing or fraud. Abuse of the hosted
instance can be reported to tarinagarwal@gmail.com.

## Contact

tarinagarwal@gmail.com
