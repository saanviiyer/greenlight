import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { FileStore, type Store } from './store.js';
import { HttpError, approveRequest, cancelMeeting, createRequest, declineRequest, getAvailableSlots } from './service.js';
import { aiEnabled, parseAvailability, triageRequests } from './ai.js';
import { rateLimit, secureEqual, securityHeaders } from './security.js';
import { ValidationError, validateAvailability } from './validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKING_HORIZON_DAYS = Math.min(365, Math.max(1, Number(process.env.BOOKING_HORIZON_DAYS) || 14));
const MIN_NOTICE_MINUTES = Math.min(10_080, Math.max(0, Number(process.env.MIN_NOTICE_MINUTES) || 60));

function bearer(req: Request): string {
  const value = req.header('authorization') ?? '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function validId(value: string): boolean { return value.length > 0 && value.length <= 150 && /^[a-zA-Z0-9_-]+$/.test(value); }

export function createApp(store: Store = new FileStore()) {
  const ownerKey = process.env.OWNER_KEY ?? '';
  if (process.env.NODE_ENV === 'production' && ownerKey.length < 12) {
    throw new Error('OWNER_KEY must be set to at least 12 characters in production.');
  }
  const ownerProtected = ownerKey.length > 0;
  const app = express();
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '256kb', strict: true }));
  app.use('/api', rateLimit(60_000, 180));

  function requireOwner(req: Request, res: Response, next: NextFunction): void {
    if (!ownerProtected && process.env.NODE_ENV !== 'production') { next(); return; }
    const provided = bearer(req);
    if (provided && secureEqual(provided, ownerKey)) { next(); return; }
    res.set('WWW-Authenticate', 'Bearer realm="greenlight-owner"');
    res.status(401).json({ error: 'Owner authentication required.' });
  }

  function wrap(handler: (req: Request, res: Response) => unknown | Promise<unknown>) {
    return async (req: Request, res: Response) => {
      try { await handler(req, res); }
      catch (error) {
        if (error instanceof HttpError) res.status(error.status).json({ error: error.message });
        else if (error instanceof ValidationError) res.status(400).json({ error: error.message });
        else { console.error(error); res.status(500).json({ error: 'Internal server error.' }); }
      }
    };
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, persistence: process.env.DATA_DIR ? 'configured' : 'local' }));
  app.get('/api/config', (_req, res) => {
    const availability = store.getAvailability();
    res.json({ aiEnabled: aiEnabled(), ownerProtected, timezone: availability.timezone, durations: availability.durations, bookingHorizonDays: BOOKING_HORIZON_DAYS, minNoticeMinutes: MIN_NOTICE_MINUTES });
  });
  app.get('/api/slots', wrap((req, res) => {
    const duration = req.query.duration === undefined ? undefined : Number(req.query.duration);
    const days = req.query.days === undefined ? undefined : Number(req.query.days);
    res.json({ slots: getAvailableSlots(store, { duration, days }) });
  }));
  app.post('/api/requests', rateLimit(15 * 60_000, 10), wrap((req, res) => {
    const request = createRequest(store, req.body ?? {});
    res.status(201).json({ id: request.id, status: request.status, statusToken: request.statusToken });
  }));
  app.get('/api/requests/:id', rateLimit(60_000, 30), wrap((req, res) => {
    if (!validId(req.params.id)) throw new HttpError(404, 'Request not found.');
    const request = store.getRequest(req.params.id);
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!request?.statusToken || !token || !secureEqual(token, request.statusToken)) throw new HttpError(404, 'Request not found.');
    res.json({ id: request.id, status: request.status, start: request.start, end: request.end, decisionMessage: request.decisionMessage });
  }));

  app.post('/api/owner/verify', rateLimit(15 * 60_000, 10), requireOwner, (_req, res) => res.json({ ok: true }));
  app.get('/api/availability', requireOwner, wrap((_req, res) => res.json(store.getAvailability())));
  app.put('/api/availability', requireOwner, wrap((req, res) => res.json(store.saveAvailability(validateAvailability(req.body)))));
  app.post('/api/availability/parse', requireOwner, wrap(async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 2_000) : '';
    if (!text) throw new HttpError(400, 'Availability description is required.');
    res.json(await parseAvailability(text));
  }));
  app.get('/api/requests', requireOwner, wrap((req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    if (status && !['pending', 'approved', 'declined'].includes(status)) throw new HttpError(400, 'Invalid request status.');
    res.json({ requests: store.listRequests(status) });
  }));
  app.post('/api/requests/:id/approve', requireOwner, wrap((req, res) => {
    if (!validId(req.params.id)) throw new HttpError(404, 'Request not found.');
    res.json(approveRequest(store, req.params.id, typeof req.body?.message === 'string' ? req.body.message : undefined));
  }));
  app.post('/api/requests/:id/decline', requireOwner, wrap((req, res) => {
    if (!validId(req.params.id)) throw new HttpError(404, 'Request not found.');
    res.json({ request: declineRequest(store, req.params.id, typeof req.body?.message === 'string' ? req.body.message : undefined) });
  }));
  app.get('/api/meetings', requireOwner, wrap((_req, res) => res.json({ meetings: store.listMeetings('confirmed').filter((meeting) => new Date(meeting.end).getTime() >= Date.now() - 86_400_000) })));
  app.post('/api/meetings/:id/cancel', requireOwner, wrap((req, res) => {
    if (!validId(req.params.id)) throw new HttpError(404, 'Meeting not found.');
    res.json({ meeting: cancelMeeting(store, req.params.id) });
  }));
  app.post('/api/triage', requireOwner, rateLimit(60_000, 10), wrap(async (_req, res) => {
    const { results, mode } = await triageRequests(store.listRequests('pending').slice(0, 100)); res.json({ results, mode });
  }));

  const distDir = path.join(__dirname, '..', 'dist');
  if (process.env.NODE_ENV === 'production' && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(distDir, 'index.html')));
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof SyntaxError) { res.status(400).json({ error: 'Malformed JSON request.' }); return; }
    console.error(error); res.status(500).json({ error: 'Internal server error.' });
  });
  return app;
}

export function startServer(port = Number(process.env.PORT) || 8787, store?: Store) {
  const app = createApp(store); const server = app.listen(port, () => {
    const address = server.address(); const activePort = typeof address === 'object' && address ? address.port : port;
    console.log(`[greenlight] server listening on http://localhost:${activePort}`);
    console.log(`[greenlight] AI mode: ${aiEnabled() ? 'live' : 'mock'}`);
  }); return server;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) startServer();
