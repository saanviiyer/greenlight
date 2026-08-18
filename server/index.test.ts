import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './index.js';
import { MemoryStore } from './store.js';
import type { Slot } from './types.js';

type Created = { id: string; statusToken: string; request?: unknown };

const originalKey = process.env.OWNER_KEY;
afterEach(() => { if (originalKey === undefined) delete process.env.OWNER_KEY; else process.env.OWNER_KEY = originalKey; });

async function running() {
  process.env.OWNER_KEY = 'a-strong-test-owner-key';
  const store = new MemoryStore({ availability: { timezone: 'UTC', weeklyWindows: [0,1,2,3,4,5,6].map((day) => ({ day, start: '09:00', end: '17:00' })), durations: [30], bufferMinutes: 0, blackoutDates: [] } });
  const server = createApp(store).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  return { store, server, base: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}` };
}
function close(server: Server) { return new Promise<void>((resolve) => server.close(() => resolve())); }

describe('HTTP booking and owner security', () => {
  it('requires owner bearer auth and an opaque token for public status', async () => {
    const { store, server, base } = await running();
    try {
      const slot = ((await (await fetch(`${base}/api/slots?duration=30`)).json()) as { slots: Slot[] }).slots[0];
      const createdResponse = await fetch(`${base}/api/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Visitor', email: 'visitor@example.com', start: slot.start, durationMinutes: 30 }) });
      expect(createdResponse.status).toBe(201);
      const created = await createdResponse.json() as Created;
      expect(created.request).toBeUndefined();
      expect(created.statusToken).toMatch(/[0-9a-f-]{36}/);
      expect((await fetch(`${base}/api/requests/${created.id}`)).status).toBe(404);
      expect((await fetch(`${base}/api/requests/${created.id}?token=${created.statusToken}`)).status).toBe(200);
      expect((await fetch(`${base}/api/requests?status=pending`)).status).toBe(401);
      const owner = { authorization: 'Bearer a-strong-test-owner-key' };
      expect((await fetch(`${base}/api/requests?status=pending`, { headers: owner })).status).toBe(200);
      expect(store.listRequests('pending')).toHaveLength(1);
    } finally { await close(server); }
  });

  it('allows only one of two conflicting approvals', async () => {
    const { server, base } = await running();
    try {
      const slot = ((await (await fetch(`${base}/api/slots?duration=30`)).json()) as { slots: Slot[] }).slots[0];
      const create = (email: string) => fetch(`${base}/api/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Visitor', email, start: slot.start, durationMinutes: 30 }) }).then((response) => response.json() as Promise<Created>);
      const [a, b] = await Promise.all([create('a@example.com'), create('b@example.com')]);
      const options = { method: 'POST', headers: { authorization: 'Bearer a-strong-test-owner-key', 'content-type': 'application/json' }, body: '{}' };
      const responses = await Promise.all([fetch(`${base}/api/requests/${a.id}/approve`, options), fetch(`${base}/api/requests/${b.id}/approve`, options)]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    } finally { await close(server); }
  });
});
