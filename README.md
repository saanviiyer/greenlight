# Greenlight

A smarter Calendly. Visitors **request** a time slot and the owner must **approve** it before the meeting is confirmed. Unlike Calendly, nothing auto-confirms. The smarter layer adds AI request triage, natural-language availability, and pure double-book prevention.

## Why it is different

Calendly hands out a link and auto-confirms whatever a visitor picks. Greenlight puts the owner in control: every booking starts as a **pending request** the owner reviews, and only an approval turns it into a confirmed meeting (and removes that time from availability so it cannot be double-booked).

## The two surfaces

Both live in one app, on two routes.

### 1. Public booking page (`/book`)

- Shows the owner's open slots, generated from the availability rules minus already-confirmed meetings and blackout dates.
- Slots are computed in the owner's timezone and shown in the visitor's local time.
- The visitor picks a server-issued slot and submits a request with name, email,
  reason, and duration. The server recomputes availability before accepting it;
  forged, stale, blackout, off-cadence, insufficient-notice, and out-of-horizon
  times are rejected.
- This creates a **pending** request and a private, tokenized live status link.

### 2. Owner dashboard (`/dashboard`)

Lightly protected by an owner passphrase from `OWNER_KEY` (open in development when unset).

- **Pending requests queue**: Approve or Decline each, with an optional message. Approving confirms the meeting and removes that time from availability. Declining records a reason.
- **Upcoming meetings**: confirmed meetings with a cancel action.
- **Availability settings**: weekly recurring windows, meeting durations, buffer between meetings, timezone, and blackout dates.

## The request to approve flow

1. Visitor submits a request on an open slot -> request is created with status `pending`.
2. The slot stays offered while pending (several people can request the same time).
3. Owner approves a request -> a confirmed meeting is created and the request becomes `approved`.
4. Slot generation now excludes that meeting (plus its buffer), so it disappears from the booking page and cannot be double-booked.
5. Approving a second request that now conflicts is rejected with a clear error. Declining records a reason and leaves the slot open.

The request state machine is `pending -> approved` or `pending -> declined`. A
decided request cannot be decided again. Approval creates the meeting and marks
the request approved in one durable transaction; a write failure rolls both back.

## Smarter features

- **AI smart triage**: summarizes and prioritizes the pending queue (ranking by the reason, flagging vague or low-context requests) and drafts approve and decline messages the owner can edit. Runs on Claude when `ANTHROPIC_API_KEY` is set, with a deterministic mock fallback when it is not.
- **Natural-language availability**: type something like "weekday afternoons 2 to 5" and it parses into weekly windows. Uses Claude when a key is present, with a rule-based parser as the fallback so it works with no key.
- **Double-book prevention**: pure, unit-tested slot generation and conflict logic (`server/slots.ts`).

## Running locally

No keys are required. AI runs in mock mode and the store is written to disk.

```bash
npm install
npm run dev
```

- Client: http://localhost:5173 (Vite dev server, proxies `/api` to the server)
- Server: http://localhost:8787

### Build and production

```bash
npm run build   # type-checks client and server, then builds the client (zero TS errors)
npm start       # serves the built client and the /api routes from one Node process
```

### Tests

```bash
npm test
```

Vitest covers slot generation, spring-forward gaps, repeated fall-back hours,
duration/buffer rules, availability validation, forged-slot rejection, durable
rollback, owner/status authorization, concurrent approval, the request state
machine, and natural-language parsing.

## Configuration

Copy `.env.example` to `.env`:

- `ANTHROPIC_API_KEY` - enables live AI triage and availability parsing. When unset, the app runs in mock mode.
- `OWNER_KEY` - passphrase that protects the dashboard and owner-only API routes. When unset, the dashboard is open (development). Set it before deploying.
- `PORT` - server port (defaults to 8787).
- `MIN_NOTICE_MINUTES` - minimum lead time for a request (default 60).
- `BOOKING_HORIZON_DAYS` - how far ahead visitors may request (default 14).
- `DATA_DIR` - durable store directory; use a mounted disk in production.
- `ANTHROPIC_MODEL` / `UPSTREAM_TIMEOUT_MS` - optional AI model and timeout.

Production refuses to start unless `OWNER_KEY` is at least 12 characters. The
client keeps it in tab-scoped `sessionStorage` and sends it as a Bearer token;
locking the dashboard or closing the tab clears access.

## Persistence

Data (availability, requests, meetings) is stored through a repository
abstraction (`Store` in `server/store.ts`). `FileStore` writes an atomic JSON
snapshot with mode `0600` and preserves the previous version as `store.json.bak`.
It fails closed on corrupt data instead of silently erasing it. Set `DATA_DIR`
to durable storage; the Render blueprint mounts `/var/data`. Tests use
`MemoryStore`, which implements the same transaction contract.

## Notifications

The private status link is the source of truth and automatically checks for a
decision. Email is still a provider hook: `server/notify.ts` records redacted
notification metadata without logging request reasons or full addresses. Real
delivery needs SMTP or a transactional-email provider; the UI does not promise
email delivery while that provider is absent.

## Deploying

- `Dockerfile` and `.dockerignore` build and run the production server.
- `Dockerfile` is a multi-stage build with production-only runtime dependencies.
- `render.yaml` defines a Render web service, persistent disk, scheduling policy,
  proxy configuration, and secrets.

The API uses same-origin browser access, strict body/input limits, CSP and other
security headers, production-safe errors, constant-time owner/token comparison,
and separate throttles for general traffic, bookings, status polling, owner
authentication, and AI triage.

## Scope and upgrade path

Greenlight is deployable as a durable single-owner service. The remaining
external-service upgrades are:

- **Multi-instance persistence**: swap `FileStore` for Postgres and enforce the
  non-overlap invariant in a serializable transaction/exclusion constraint.
  Run only one application instance while using `FileStore`.
- **Auth**: replace the single `OWNER_KEY` passphrase with real authentication (for example Supabase Auth or another identity provider), and scope data per owner.
- **Email/calendar**: implement the notification hook with SMTP/Resend/Postmark/
  SES and attach calendar invitations after successful delivery.
- **Multi-owner**: add an owner/organization dimension to availability, requests, and meetings, and route the public booking page per owner (for example `/book/:ownerSlug`).

## Project layout

```
server/
  index.ts          Express app: /api routes + static client in production
  service.ts        Business logic: request state machine, double-book prevention
  slots.ts          Pure slot generation and conflict logic (unit tested)
  nlAvailability.ts Rule-based natural-language parser (unit tested)
  ai.ts             Claude triage + availability parsing, with mock fallback
  store.ts          Store interface, FileStore (JSON on disk), MemoryStore (tests)
  notify.ts         Stubbed email notification hook
  time.ts           Timezone helpers (Intl based)
  *.test.ts         Vitest suites
src/
  App.tsx           Router and shell
  pages/            BookingPage, Dashboard
  api.ts            Typed fetch client
  lib/time.ts       Client formatting helpers
```
