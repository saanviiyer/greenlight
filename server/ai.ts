// AI layer: smart request triage and natural-language availability parsing.
// Uses the Anthropic SDK (model claude-sonnet-5) when ANTHROPIC_API_KEY is set,
// and falls back to deterministic offline logic (MOCK MODE) otherwise or on any
// error, so the app works end to end with no key.

import Anthropic from '@anthropic-ai/sdk';
import type { MeetingRequest, TriageResult, WeeklyWindow } from './types.js';
import { parseAvailabilityText } from './nlAvailability.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

function client(): Anthropic {
  return new Anthropic({ timeout: Number(process.env.UPSTREAM_TIMEOUT_MS) || 30_000, maxRetries: 2 });
}

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ---- Request triage --------------------------------------------------------

const HIGH_SIGNALS = [
  'urgent',
  'asap',
  'deadline',
  'interview',
  'investor',
  'offer',
  'contract',
  'today',
  'tomorrow',
  'blocker',
  'production',
  'outage',
];

function mockTriageOne(r: MeetingRequest): TriageResult {
  const note = (r.note || '').trim();
  const lower = note.toLowerCase();
  const flags: string[] = [];
  if (note.length < 15) flags.push('low-context');
  if (!note) flags.push('no-reason');

  let priority: TriageResult['priority'] = 'low';
  if (HIGH_SIGNALS.some((s) => lower.includes(s))) priority = 'high';
  else if (note.length >= 40) priority = 'medium';

  const summary = note
    ? note.length > 90
      ? `${note.slice(0, 90).trim()}...`
      : note
    : 'No reason provided by the requester.';

  const first = r.name.split(' ')[0] || 'there';
  const draftApprove = `Hi ${first}, your requested time works. I have confirmed the meeting and you will get the details shortly. Looking forward to it.`;
  const draftDecline = `Hi ${first}, thank you for the request. Unfortunately that time does not work for me. Could you share a couple of alternative times or a bit more context on what you would like to cover?`;

  return { id: r.id, priority, summary, flags, draftApprove, draftDecline };
}

function mockTriage(requests: MeetingRequest[]): TriageResult[] {
  const order = { high: 0, medium: 1, low: 2 } as const;
  return requests
    .map(mockTriageOne)
    .sort((a, b) => order[a.priority] - order[b.priority]);
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  const startObj = candidate.indexOf('{');
  const from =
    start === -1 ? startObj : startObj === -1 ? start : Math.min(start, startObj);
  const lastArr = candidate.lastIndexOf(']');
  const lastObj = candidate.lastIndexOf('}');
  const to = Math.max(lastArr, lastObj);
  if (from === -1 || to === -1) throw new Error('No JSON found');
  return JSON.parse(candidate.slice(from, to + 1));
}

export async function triageRequests(
  requests: MeetingRequest[],
): Promise<{ results: TriageResult[]; mode: 'ai' | 'mock' }> {
  if (requests.length === 0) return { results: [], mode: aiEnabled() ? 'ai' : 'mock' };
  if (!aiEnabled()) return { results: mockTriage(requests), mode: 'mock' };

  try {
    const anthropic = client();
    const payload = requests.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      note: r.note,
      start: r.start,
      durationMinutes: r.durationMinutes,
    }));
    const prompt = `You are triaging pending meeting requests for a busy person.
For each request return an object with:
- id: the request id (unchanged)
- priority: "high", "medium", or "low" based on how time-sensitive and well-justified the reason is
- summary: one short sentence summarizing the reason
- flags: array of short strings for concerns (for example "low-context", "no-reason", "vague")
- draftApprove: a friendly 1-2 sentence approval message addressed to the requester by first name
- draftDecline: a polite 1-2 sentence decline message asking for alternative times or more context

Return ONLY a JSON array, sorted highest priority first. Requests:
${JSON.stringify(payload, null, 2)}`;

    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const parsed = extractJson(text) as Array<Partial<TriageResult>>;
    const byId = new Map(requests.map((r) => [r.id, r]));
    const results: TriageResult[] = parsed
      .filter((p) => p.id && byId.has(p.id))
      .map((p) => {
        const base = mockTriageOne(byId.get(p.id as string)!);
        return {
          id: p.id as string,
          priority: p.priority && ['high', 'medium', 'low'].includes(p.priority) ? p.priority : base.priority,
          summary: typeof p.summary === 'string' ? p.summary.slice(0, 500) : base.summary,
          flags: Array.isArray(p.flags) ? p.flags.slice(0, 10).map(String).map((value) => value.slice(0, 80)) : base.flags,
          draftApprove: typeof p.draftApprove === 'string' ? p.draftApprove.slice(0, 2_000) : base.draftApprove,
          draftDecline: typeof p.draftDecline === 'string' ? p.draftDecline.slice(0, 2_000) : base.draftDecline,
        };
      });
    // Make sure every request is represented even if the model dropped one.
    for (const r of requests) {
      if (!results.some((x) => x.id === r.id)) results.push(mockTriageOne(r));
    }
    return { results, mode: 'ai' };
  } catch (err) {
    console.error('[ai] triage failed, using mock:', (err as Error).message);
    return { results: mockTriage(requests), mode: 'mock' };
  }
}

// ---- Natural-language availability -----------------------------------------

export async function parseAvailability(
  text: string,
): Promise<{ windows: WeeklyWindow[]; warnings: string[]; mode: 'ai' | 'rule' }> {
  const fallback = parseAvailabilityText(text);
  if (!aiEnabled()) return { ...fallback, mode: 'rule' };

  try {
    const anthropic = client();
    const prompt = `Convert this availability description into weekly recurring windows.
Return ONLY a JSON array of objects with:
- day: integer 0-6 where 0 is Sunday and 6 is Saturday
- start: "HH:MM" 24-hour local time
- end: "HH:MM" 24-hour local time

Description: "${text}"`;
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });
    const out = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const parsed = extractJson(out) as WeeklyWindow[];
    const windows = parsed
      .filter(
        (w) =>
          typeof w.day === 'number' &&
          w.day >= 0 &&
          w.day <= 6 &&
          /^\d{2}:\d{2}$/.test(w.start) &&
          /^\d{2}:\d{2}$/.test(w.end),
      )
      .map((w) => ({ day: w.day, start: w.start, end: w.end }));
    if (windows.length === 0) return { ...fallback, mode: 'rule' };
    return { windows, warnings: [], mode: 'ai' };
  } catch (err) {
    console.error('[ai] availability parse failed, using rule-based:', (err as Error).message);
    return { ...fallback, mode: 'rule' };
  }
}
