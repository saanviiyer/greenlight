# Greenlight

A smarter Calendly. Visitors **request** a time slot and the owner must **approve** it before the meeting is confirmed. Unlike Calendly, nothing auto-confirms. The smarter layer adds AI request triage, natural-language availability, and pure double-book prevention.

## Why it is different

Calendly hands out a link and auto-confirms whatever a visitor picks. Greenlight puts the owner in control: every booking starts as a **pending request** the owner reviews, and only an approval turns it into a confirmed meeting (and removes that time from availability so it cannot be double-booked).

## The two surfaces

Both live in one app, on two routes.

### 1. Public booking page (`/book`)

- Shows the owner's open slots, generated from the availability rules minus already-confirmed meetings and blackout dates.
- Slots are computed in the owner's timezone and shown in the visitor's local time.
- The visitor picks a slot and submits a request with name, email, reason, and duration.
- This creates a **pending** request and shows a confirmation with a request id and a live status link.

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

The request state machine is `pending -> approved` or `pending -> declined`. A decided request cannot be decided again.

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

Vitest covers the pure logic: slot generation (timezone, duration, buffer), double-book prevention on approval, the request state machine, and natural-language availability parsing.

## Configuration

Copy `.env.example` to `.env`:

- `ANTHROPIC_API_KEY` - enables live AI triage and availability parsing. When unset, the app runs in mock mode.
- `OWNER_KEY` - passphrase that protects the dashboard and owner-only API routes. When unset, the dashboard is open (development). Set it before deploying.
- `PORT` - server port (defaults to 8787).

## Persistence

Data (availability, requests, meetings) is stored through a repository abstraction (`Store` in `server/store.ts`). The default implementation is `FileStore`, a file-backed JSON store under `server/data/store.json`, so everything survives restarts. Tests use `MemoryStore`, which implements the same interface.

## Notifications

In-app status is the source of truth. Email is **stubbed**: `server/notify.ts` logs every notification and exposes a `sendNotification` hook. Real delivery needs an SMTP or transactional-email provider and is out of scope for this MVP.

## Deploying

- `Dockerfile` and `.dockerignore` build and run the production server.
- `render.yaml` defines a Render web service with `ANTHROPIC_API_KEY` and `OWNER_KEY` as `sync: false` secrets.

## Scope and upgrade path

This is a **single-owner MVP**. To take it further:

- **Persistence**: swap `FileStore` for a Supabase or Postgres implementation of the `Store` interface. Because the service and HTTP layers only depend on the interface, no business logic changes.
- **Auth**: replace the single `OWNER_KEY` passphrase with real authentication (for example Supabase Auth or another identity provider), and scope data per owner.
- **Email**: implement `sendNotification` against an email provider (SMTP, Resend, Postmark, SES) so requesters and the owner get real notifications.
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
