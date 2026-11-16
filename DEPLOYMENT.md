# Deployment — Sea Sentry AI

This document covers the production deployment path. It contains no credentials.

## Architecture

- **Railway Node service** runs Next.js (`npm run build`, `next start`) and all server-side APIs.
- **Railway PostgreSQL** stores incidents, delivery records, push subscriptions and settings.
- **Browser** performs camera capture, TensorFlow.js inference, tracking, heatmap rendering and local siren/recorded-voice playback.
- **HTTPS** is required for camera access and Web Push outside localhost.
- **SSE** (`/api/events`) carries incident updates to the operator console.

The Railway server never has access to the operator's USB camera. Camera access happens only in an authorised browser session on a device physically connected to a camera.

## Required environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Railway PostgreSQL reference variable. Never expose as `NEXT_PUBLIC_*`. |
| `OPERATOR_PASSWORD` **or** `OPERATOR_PASSWORD_HASH` | yes | Single-operator login. Prefer a scrypt hash. |
| `SESSION_SECRET` | yes | At least 24 random characters; signs the HTTP-only session cookie. |
| `PUBLIC_BASE_URL` | yes | Public HTTPS origin, used in notifications, evidence links and telephony callbacks. |
| `NEXT_PUBLIC_APP_URL` | optional | Public application URL for documentation/links. |

## Optional notification variables

| Variable | Purpose |
| --- | --- |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push. Generate with `npx web-push generate-vapid-keys`. Never expose the private key. |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token, server-side only. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Optional Twilio Programmable Voice. |
| `TWILIO_STATUS_SECRET` | Secret appended to Twilio status callback URLs. |

If optional credentials are absent, the channel reports **NOT CONFIGURED**; other channels still operate.

## Railway deployment

1. Create a Railway project with a **PostgreSQL** service.
2. Create a Node service from GitHub repository `https://github.com/yaseztaha-cyber/Sea_sentary_ai`, branch `main`.
3. Add the variables above to the Node service. Use Railway's PostgreSQL reference for `DATABASE_URL` (for example, a reference to the database service's `DATABASE_URL`).
4. `railway.json` sets:
   - build: `npm ci && npm run build`
   - start: `npm run db:migrate && npm start`
   - health check: `/api/health`
5. Generate a Railway HTTPS domain and set `PUBLIC_BASE_URL` / `NEXT_PUBLIC_APP_URL` to it. Redeploy after changing them.
6. Verify deployment logs show `database migrations applied` and `Ready`.
7. Open `/api/health`; it must return HTTP 200 with `database: "up"` and `schema: "ready"`.

### Database migrations

The SQL migration is `drizzle/0000_init.sql`. `npm run db:migrate` is idempotent for a fresh database via Drizzle's migration journal. It creates tables; it does not delete data. Take a Railway PostgreSQL backup/recovery point before any future schema change that alters existing tables.

### Operator access

`/app`, incident APIs, settings, SSE, evidence, audio assets, push subscriptions and notification tests are protected by middleware. The public landing page and health endpoint remain public. Login is a single operator password; there is no public registration. Cookies are HTTP-only, SameSite=Strict and Secure in production. Sessions expire after 12 hours. Mutating requests reject cross-origin `Origin` headers. Login attempts are rate-limited per IP.

## Web Push validation

1. Configure VAPID keys before deployment.
2. Open Settings → Notification channels → Web Push.
3. Click **Subscribe this browser** and grant notification permission.
4. Click **Test push**.
5. `SENT` means the push service accepted the request. Actual device delivery must be observed in the browser/OS notification center; the app does not claim delivery without that observation.

## Telegram validation

1. Set `TELEGRAM_BOT_TOKEN` on the server.
2. Start a conversation with the bot or add it to the destination chat.
3. Enter the chat ID in Settings and click **Verify chat**, then **Send test**.
4. A Telegram message is not a phone call.

## Phone validation

1. Configure Twilio variables and a publicly reachable `PUBLIC_BASE_URL`.
2. Keep **Automatic escalation calls** disabled until **Verify provider** and a non-emergency test call have succeeded.
3. Status callbacks update `SENT` → `RINGING`/`ANSWERED`/`COMPLETED` or failure states. An API 201 only means the call was initiated.
4. Public emergency numbers are rejected. Only explicitly configured, authorised responders are allowed.

## Camera and AI limits

- HTTPS camera permission is required on the deployment domain.
- TensorFlow.js runs in the operator's browser; Railway does not run the detector.
- A remote fixed beach camera requires a separate secured IP-camera/edge stream integration. None is included.
- The distress engine is an experimental human-review screening baseline, not a validated drowning detector.

## Backups and rollback

- Enable Railway PostgreSQL backups/recovery points.
- Roll back application code with Railway's previous deployment or by reverting the GitHub commit and redeploying.
- Never roll back a database migration blindly. Restore from a verified backup if a migration is destructive.
- Keep the previous deployment available until `/api/health` and the operator login smoke test pass.

## Local production smoke test

```powershell
npm ci
npm run build
npm run db:migrate
npm start
# open http://127.0.0.1:3000
```
