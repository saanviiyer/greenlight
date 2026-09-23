# Greenlight

Greenlight is a scheduling app. Visitors request a time slot, and the owner must approve the request before the meeting is confirmed. Nothing confirms automatically. The app also has AI request triage, natural-language availability and double-book prevention.

## How it works

Calendly confirms whatever time a visitor picks. In Greenlight, every booking starts as a pending request. Only the owner's approval turns it into a confirmed meeting. The approval also removes that time from availability, so nobody can book it twice.

The app has two routes.

### Public booking page (`/book`)

- The page shows open slots. The server makes them from the availability rules. It removes confirmed meetings and blackout dates.
- The server computes slots in the owner's timezone. The page shows them in the visitor's local time.
- The visitor picks a slot from the server and sends a request with name, email, reason and duration. The server computes availability again before it accepts the request. It rejects forged times, stale times, blackout times, off-cadence times, times with too little notice and times past the booking horizon.
- The request starts as pending. The visitor gets a private, tokenized status link.

### Owner dashboard (`/dashboard`)

An owner passphrase from `OWNER_KEY` protects the dashboard. When `OWNER_KEY` is unset in development, the dashboard is open.

- Pending requests. The owner approves or declines each one, with an optional message. A decline records a reason.
- Upcoming meetings. The owner can cancel a confirmed meeting.
- Availability settings. Weekly windows, meeting durations, buffer between meetings, timezone and blackout dates.

### Request flow

1. A visitor requests an open slot. The request has status `pending`.
2. The slot stays open while the request is pending. More than one person can request the same time.
3. The owner approves a request. The server creates a confirmed meeting and sets the request to `approved`.
4. Slot generation now excludes that meeting and its buffer. The slot leaves the booking page.
5. If the owner approves a second request that now conflicts, the server rejects it with a clear error. A decline records a reason and keeps the slot open.

A request goes from `pending` to `approved` or from `pending` to `declined`. The owner cannot decide a request twice. Approval creates the meeting and marks the request in one durable transaction. If the write fails, both changes roll back.

### AI and smart features

- AI triage. The app summarizes and ranks the pending queue by reason. It flags vague requests and drafts approve and decline messages that the owner can edit. It uses Claude when `ANTHROPIC_API_KEY` is set. Otherwise a deterministic mock runs.
- Natural-language availability. You type text like "weekday afternoons 2 to 5" and the app turns it into weekly windows. It uses Claude when a key is set. Otherwise a rule-based parser runs.
- Double-book prevention. Slot generation and conflict logic are pure functions with unit tests (`server/slots.ts`).

## Run it

You need no keys. AI runs in mock mode and the store is written to disk.

```bash
git clone https://github.com/saanviiyer/greenlight
cd greenlight
npm install
npm run dev
```

- Client: http://localhost:5173 (Vite, sends `/api` to the server)
- Server: http://localhost:8787

Tests:

```bash
npm test
```

The Vitest suites cover slot generation, spring-forward gaps, repeated fall-back hours and duration and buffer rules. They also cover availability validation, forged-slot rejection, durable rollback, owner and status authorization, concurrent approval, the request state machine and natural-language parsing.

Production:

```bash
npm run build   # type-checks client and server, then builds the client
npm start       # one Node process serves the client and /api
```

### Deploy

The `Dockerfile` is a multi-stage build with production-only runtime dependencies. `render.yaml` defines a Render web service with a persistent disk at `/var/data`, the scheduling policy, the proxy setting and the secrets.

In production, the server does not start unless `OWNER_KEY` has at least 12 characters. The client keeps the key in tab-scoped `sessionStorage` and sends it as a Bearer token. Locking the dashboard or closing the tab removes access.

The API allows same-origin browser access only. It has strict body and input limits, CSP and other security headers, safe production errors and constant-time comparison for owner keys and tokens. It has separate throttles for general traffic, bookings, status polling, owner login and AI triage.

## Environment variables

Copy `.env.example` to `.env`.

| Name | Purpose | Required |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Live AI triage and availability parsing. Without it, the app runs in mock mode. | Optional |
| `ANTHROPIC_MODEL` | AI model. Default is `claude-sonnet-5`. | Optional |
| `UPSTREAM_TIMEOUT_MS` | AI request timeout. Default is 30000. | Optional |
| `OWNER_KEY` | Passphrase for the dashboard and owner-only API routes. Open when unset in development. | Required in production (12+ characters) |
| `MIN_NOTICE_MINUTES` | Minimum lead time for a request. Default is 60. | Optional |
| `BOOKING_HORIZON_DAYS` | How far ahead visitors can book. Default is 14. | Optional |
| `DATA_DIR` | Store directory. Use a mounted disk in production. Default is `server/data`. | Optional |
| `TRUST_PROXY` | Set to 1 only behind one trusted reverse proxy. | Optional |
| `PORT` | Server port. Default is 8787. | Optional |
| `LOG_NOTIFICATION_BODIES` | Set to 1 to log notification bodies. | Optional |

## Persistence

All data (availability, requests, meetings) goes through the `Store` interface in `server/store.ts`. `FileStore` writes an atomic JSON snapshot with mode `0600` and keeps the previous version as `store.json.bak`. If the data is corrupt, it stops with an error and does not erase the data. Tests use `MemoryStore`, which has the same transaction contract.

## Notifications

The private status link is the source of truth. It checks for a decision automatically. Email is only a hook. `server/notify.ts` logs redacted notification metadata and does not log request reasons or full addresses. Real delivery needs SMTP or a transactional-email provider. Until then, the UI does not promise email delivery.

## Limits and next steps

Greenlight runs as a durable service for one owner. These upgrades need external services:

- Multi-instance persistence. Replace `FileStore` with Postgres and enforce the non-overlap rule in a serializable transaction or an exclusion constraint. With `FileStore`, run only one instance.
- Auth. Replace the single `OWNER_KEY` with real authentication (for example Supabase Auth) and scope data per owner.
- Email and calendar. Implement the notification hook with SMTP, Resend, Postmark or SES. Attach calendar invitations after delivery succeeds.
- Multi-owner. Add an owner or organization field to availability, requests and meetings. Route the booking page per owner (for example `/book/:ownerSlug`).

## Layout

```
server/
  index.ts          Express app, /api routes, static client in production
  service.ts        request state machine, double-book prevention
  slots.ts          pure slot generation and conflict logic (tested)
  nlAvailability.ts rule-based natural-language parser (tested)
  ai.ts             Claude triage and availability parsing, mock fallback
  store.ts          Store interface, FileStore, MemoryStore
  notify.ts         email notification hook (stub)
  security.ts       security helpers
  validate.ts       input validation
  time.ts           timezone helpers (Intl)
  *.test.ts         Vitest suites
src/
  App.tsx           router and shell
  pages/            BookingPage, Dashboard
  api.ts            typed fetch client
  lib/time.ts       client formatting helpers
```
