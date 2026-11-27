# THE BUTTON

A global internet experiment. One central button. One shared global counter.
Built with Cloudflare Pages, D1, Google OAuth, and Stripe.

## Architecture
- **Frontend:** Vanilla HTML/CSS/JS (no build step) in `/public`.
- **Backend:** Cloudflare Pages Functions in `/functions`.
- **Database:** Cloudflare D1 (SQLite).
- **Auth:** Google OAuth 2.0.
- **Payments:** Stripe Checkout (hosted) + Webhooks.

## Local Development
1. Install dependencies: `npm install`
2. Create `.dev.vars` from `.dev.vars.example` and fill in your secrets.
3. Apply local database migrations: `npm run db:migrate:local`
4. Start the local server: `npm run dev`

## Deployment
1. Create the D1 database on Cloudflare: `npx wrangler d1 create the-button-db`
2. Copy the `database_id` into `wrangler.toml`.
3. Apply remote migrations: `npm run db:migrate:remote`
4. Deploy via GitHub integration or CLI: `npm run deploy`
