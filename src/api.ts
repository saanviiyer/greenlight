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
  return localStorage.getItem(KEY_STORAGE) ?? '';
}

export function setOwnerKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key);
}

export function clearOwnerKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

async function req<T>(
  method: string,
  url: string,
  body?: unknown,
  owner = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (owner) headers['x-owner-key'] = getOwnerKey();
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
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
    req<{ id: string; status: string; request: MeetingRequest }>(
      'POST',
      '/api/requests',
      input,
    ),
  requestStatus: (id: string) =>
    req<{ id: string; status: string; decisionMessage?: string }>(
      'GET',
      `/api/requests/${id}`,
    ),

  // Owner
  verifyOwner: (key: string) =>
    req<{ ok: boolean }>('POST', '/api/owner/verify', { key }),
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
