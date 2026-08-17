// Express server: serves the /api routes and, in production, the built client.
// File-backed store keeps data across restarts.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { FileStore } from './store.js';
import {
  HttpError,
  approveRequest,
  cancelMeeting,
  createRequest,
  declineRequest,
  getAvailableSlots,
} from './service.js';
import { aiEnabled, parseAvailability, triageRequests } from './ai.js';
import type { Availability } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const store = new FileStore();
const app = express();
app.use(express.json());

const OWNER_KEY = process.env.OWNER_KEY;
const ownerProtected = Boolean(OWNER_KEY);

// Owner-only guard. Open in development when OWNER_KEY is unset.
function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (!ownerProtected) return next();
  const provided = req.header('x-owner-key');
  if (provided && provided === OWNER_KEY) return next();
  res.status(401).json({ error: 'Owner passphrase required.' });
}

function wrap(
  handler: (req: Request, res: Response) => unknown | Promise<unknown>,
) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        console.error(err);
        res.status(500).json({ error: 'Internal server error.' });
      }
    }
  };
}

// ---- Public routes ---------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/config', (_req, res) => {
  const availability = store.getAvailability();
  res.json({
    aiEnabled: aiEnabled(),
    ownerProtected,
    timezone: availability.timezone,
    durations: availability.durations,
  });
});

app.get(
  '/api/slots',
  wrap((req, res) => {
    const duration = req.query.duration
      ? Number(req.query.duration)
      : undefined;
    const days = req.query.days ? Number(req.query.days) : undefined;
    const slots = getAvailableSlots(store, { duration, days });
    res.json({ slots });
  }),
);

app.post(
  '/api/requests',
  wrap((req, res) => {
    const request = createRequest(store, req.body);
    res.status(201).json({ id: request.id, status: request.status, request });
  }),
);

// Public status lookup for a single request (visitors follow their request).
app.get(
  '/api/requests/:id',
  wrap((req, res) => {
    const request = store.getRequest(req.params.id);
    if (!request) throw new HttpError(404, 'Request not found.');
    res.json({
      id: request.id,
      status: request.status,
      start: request.start,
      end: request.end,
      decisionMessage: request.decisionMessage,
    });
  }),
);

// ---- Owner routes ----------------------------------------------------------

app.post(
  '/api/owner/verify',
  wrap((req, res) => {
    if (!ownerProtected) return res.json({ ok: true });
    res.json({ ok: (req.body?.key ?? '') === OWNER_KEY });
  }),
);

app.get(
  '/api/availability',
  requireOwner,
  wrap((_req, res) => {
    res.json(store.getAvailability());
  }),
);

app.put(
  '/api/availability',
  requireOwner,
  wrap((req, res) => {
    const body = req.body as Availability;
    if (!body.timezone || !Array.isArray(body.weeklyWindows)) {
      throw new HttpError(400, 'Invalid availability payload.');
    }
    // Validate the timezone is usable before saving.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: body.timezone });
    } catch {
      throw new HttpError(400, `Unknown timezone: ${body.timezone}`);
    }
    const saved = store.saveAvailability({
      timezone: body.timezone,
      weeklyWindows: body.weeklyWindows,
      durations:
        Array.isArray(body.durations) && body.durations.length > 0
          ? body.durations
          : [30],
      bufferMinutes: Number(body.bufferMinutes) || 0,
      blackoutDates: Array.isArray(body.blackoutDates) ? body.blackoutDates : [],
    });
    res.json(saved);
  }),
);

app.post(
  '/api/availability/parse',
  requireOwner,
  wrap(async (req, res) => {
    const text = String(req.body?.text ?? '');
    const parsed = await parseAvailability(text);
    res.json(parsed);
  }),
);

app.get(
  '/api/requests',
  requireOwner,
  wrap((req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    res.json({ requests: store.listRequests(status) });
  }),
);

app.post(
  '/api/requests/:id/approve',
  requireOwner,
  wrap((req, res) => {
    const result = approveRequest(store, req.params.id, req.body?.message);
    res.json(result);
  }),
);

app.post(
  '/api/requests/:id/decline',
  requireOwner,
  wrap((req, res) => {
    const request = declineRequest(store, req.params.id, req.body?.message);
    res.json({ request });
  }),
);

app.get(
  '/api/meetings',
  requireOwner,
  wrap((_req, res) => {
    const meetings = store
      .listMeetings('confirmed')
      .filter((m) => new Date(m.end).getTime() >= Date.now() - 86_400_000);
    res.json({ meetings });
  }),
);

app.post(
  '/api/meetings/:id/cancel',
  requireOwner,
  wrap((req, res) => {
    const meeting = cancelMeeting(store, req.params.id);
    res.json({ meeting });
  }),
);

app.post(
  '/api/triage',
  requireOwner,
  wrap(async (_req, res) => {
    const pending = store.listRequests('pending');
    const { results, mode } = await triageRequests(pending);
    res.json({ results, mode });
  }),
);

// ---- Static client in production ------------------------------------------

const distDir = path.join(__dirname, '..', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`[greenlight] server listening on http://localhost:${port}`);
  console.log(
    `[greenlight] AI mode: ${aiEnabled() ? 'live (ANTHROPIC_API_KEY set)' : 'mock (no key)'}`,
  );
  console.log(
    `[greenlight] Owner dashboard: ${ownerProtected ? 'passphrase protected' : 'OPEN (set OWNER_KEY to protect)'}`,
  );
});
