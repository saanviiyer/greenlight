import type {
  AppConfig,
  Availability,
  Meeting,
  MeetingRequest,
  Slot,
  TriageResult,
  WeeklyWindow,
} from './types';

const KEY_STORAGE = 'greenlight_owner_key';

export function getOwnerKey(): string {
  return sessionStorage.getItem(KEY_STORAGE) ?? '';
}

export function setOwnerKey(key: string): void {
  sessionStorage.setItem(KEY_STORAGE, key);
}

export function clearOwnerKey(): void {
  sessionStorage.removeItem(KEY_STORAGE);
}

async function req<T>(
  method: string,
  url: string,
  body?: unknown,
  owner = false,
  explicitOwnerKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (owner) headers.Authorization = `Bearer ${explicitOwnerKey ?? getOwnerKey()}`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error('The request timed out. Please try again.');
    throw new Error('Could not reach Greenlight. Check your connection and try again.');
  } finally { window.clearTimeout(timer); }
  const text = await res.text();
  let data: { error?: string } = {};
  try { data = text ? JSON.parse(text) as { error?: string } : {}; }
  catch { if (res.ok) throw new Error('The server returned an invalid response.'); }
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  config: () => req<AppConfig>('GET', '/api/config'),

  // Public booking
  slots: (duration: number) =>
    req<{ slots: Slot[] }>('GET', `/api/slots?duration=${duration}`),
  createRequest: (input: {
    name: string;
    email: string;
    note: string;
    start: string;
    durationMinutes: number;
  }) =>
    req<{ id: string; status: string; statusToken: string }>(
      'POST',
      '/api/requests',
      input,
    ),
  requestStatus: (id: string, token: string) =>
    req<{ id: string; status: string; decisionMessage?: string }>(
      'GET',
      `/api/requests/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`,
    ),

  // Owner
  verifyOwner: (key: string) =>
    req<{ ok: boolean }>('POST', '/api/owner/verify', {}, true, key),
  availability: () => req<Availability>('GET', '/api/availability', undefined, true),
  saveAvailability: (a: Availability) =>
    req<Availability>('PUT', '/api/availability', a, true),
  parseAvailability: (text: string) =>
    req<{ windows: WeeklyWindow[]; warnings: string[]; mode: string }>(
      'POST',
      '/api/availability/parse',
      { text },
      true,
    ),
  pending: () =>
    req<{ requests: MeetingRequest[] }>(
      'GET',
      '/api/requests?status=pending',
      undefined,
      true,
    ),
  meetings: () =>
    req<{ meetings: Meeting[] }>('GET', '/api/meetings', undefined, true),
  approve: (id: string, message: string) =>
    req<{ request: MeetingRequest; meeting: Meeting }>(
      'POST',
      `/api/requests/${id}/approve`,
      { message },
      true,
    ),
  decline: (id: string, message: string) =>
    req<{ request: MeetingRequest }>(
      'POST',
      `/api/requests/${id}/decline`,
      { message },
      true,
    ),
  cancel: (id: string) =>
    req<{ meeting: Meeting }>(
      'POST',
      `/api/meetings/${id}/cancel`,
      {},
      true,
    ),
  triage: () =>
    req<{ results: TriageResult[]; mode: string }>(
      'POST',
      '/api/triage',
      {},
      true,
    ),
};
