import { useEffect, useState } from 'react';
import { api, clearOwnerKey, getOwnerKey, setOwnerKey } from '../api';
import type {
  AppConfig,
  Availability,
  Meeting,
  MeetingRequest,
  TriageResult,
  WeeklyWindow,
} from '../types';
import { formatDateTime } from '../lib/time';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Dashboard() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<'pending' | 'upcoming' | 'availability'>('pending');

  useEffect(() => {
    api.config().then((c) => {
      setConfig(c);
      if (!c.ownerProtected) setAuthed(true);
    });
  }, []);

  if (!config) return <p className="text-slate-500">Loading...</p>;

  if (config.ownerProtected && !authed) {
    return <OwnerGate onAuthed={() => setAuthed(true)} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Owner dashboard</h1>
        {config.ownerProtected && (
          <button
            onClick={() => {
              clearOwnerKey();
              setAuthed(false);
            }}
            className="text-sm text-slate-500 underline hover:text-slate-700"
          >
            Lock
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        AI triage:{' '}
        <span className={config.aiEnabled ? 'text-brand-700' : 'text-amber-600'}>
          {config.aiEnabled ? 'live' : 'mock mode (no API key)'}
        </span>
      </p>

      <div className="mt-5 flex gap-1 border-b border-slate-200">
        {(['pending', 'upcoming', 'availability'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize ${
              tab === t
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === 'pending' && <PendingTab />}
        {tab === 'upcoming' && <UpcomingTab />}
        {tab === 'availability' && <AvailabilityTab config={config} />}
      </div>
    </div>
  );
}

function OwnerGate({ onAuthed }: { onAuthed: () => void }) {
  const [key, setKey] = useState(getOwnerKey());
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit() {
    setChecking(true);
    setError(null);
    try {
      const r = await api.verifyOwner(key);
      if (r.ok) { setOwnerKey(key); onAuthed(); }
      else setError('Incorrect passphrase.');
    } catch (e) {
      setError(String((e as Error).message));
      clearOwnerKey();
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Owner access</h2>
      <p className="mt-1 text-sm text-slate-500">
        Enter the owner passphrase to manage requests and availability.
      </p>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="input mt-4"
        placeholder="Passphrase"
        autoComplete="current-password"
        aria-label="Owner passphrase"
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button
        onClick={submit}
        disabled={checking}
        className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {checking ? 'Checking...' : 'Unlock'}
      </button>
    </div>
  );
}

function PendingTab() {
  const [requests, setRequests] = useState<MeetingRequest[]>([]);
  const [triage, setTriage] = useState<Record<string, TriageResult>>({});
  const [triageMode, setTriageMode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [triaging, setTriaging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api
      .pending()
      .then((r) => setRequests(r.requests))
      .catch((e) => setError(String(e.message)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function runTriage() {
    setTriaging(true);
    try {
      const r = await api.triage();
      const map: Record<string, TriageResult> = {};
      for (const t of r.results) map[t.id] = t;
      setTriage(map);
      setTriageMode(r.mode);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setTriaging(false);
    }
  }

  if (loading) return <p className="text-slate-500">Loading...</p>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-600">
          {requests.length} pending request{requests.length === 1 ? '' : 's'}
        </p>
        <button
          onClick={runTriage}
          disabled={triaging || requests.length === 0}
          className="rounded-lg border border-brand-600 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
        >
          {triaging ? 'Analyzing...' : 'AI smart triage'}
        </button>
      </div>
      {triageMode && (
        <p className="mb-3 text-xs text-slate-400">
          Triage generated in {triageMode} mode. Requests are ranked by priority.
        </p>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {requests.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-500">
          No pending requests.
        </p>
      ) : (
        <div className="space-y-4">
          {sortByTriage(requests, triage).map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              triage={triage[r.id]}
              onDone={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function sortByTriage(
  requests: MeetingRequest[],
  triage: Record<string, TriageResult>,
): MeetingRequest[] {
  const order = { high: 0, medium: 1, low: 2 } as const;
  return [...requests].sort((a, b) => {
    const pa = triage[a.id] ? order[triage[a.id].priority] : 3;
    const pb = triage[b.id] ? order[triage[b.id].priority] : 3;
    if (pa !== pb) return pa - pb;
    return a.start.localeCompare(b.start);
  });
}

function RequestCard({
  request,
  triage,
  onDone,
}: {
  request: MeetingRequest;
  triage?: TriageResult;
  onDone: () => void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: 'approve' | 'decline') {
    if (kind === 'decline' && !confirm(`Decline ${request.name}'s request? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'approve') await api.approve(request.id, message);
      else await api.decline(request.id, message);
      onDone();
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(false);
    }
  }

  const priorityBadge = triage && (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        triage.priority === 'high'
          ? 'bg-red-100 text-red-700'
          : triage.priority === 'medium'
            ? 'bg-amber-100 text-amber-700'
            : 'bg-slate-100 text-slate-600'
      }`}
    >
      {triage.priority} priority
    </span>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{request.name}</h3>
            {priorityBadge}
          </div>
          <p className="text-sm text-slate-500">{request.email}</p>
        </div>
        <div className="text-right text-sm text-slate-600">
          <p className="font-medium">{formatDateTime(request.start)}</p>
          <p className="text-xs text-slate-400">{request.durationMinutes} min</p>
        </div>
      </div>

      {request.note ? (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {request.note}
        </p>
      ) : (
        <p className="mt-3 text-sm italic text-slate-400">No reason provided.</p>
      )}

      {triage && (
        <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm">
          <p className="font-medium text-brand-800">AI summary</p>
          <p className="text-brand-700">{triage.summary}</p>
          {triage.flags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {triage.flags.map((f) => (
                <span
                  key={f}
                  className="rounded-full bg-white px-2 py-0.5 text-xs text-amber-700"
                >
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Optional message to the requester"
        className="input mt-3 h-16 resize-none"
      />
      {triage && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <button
            onClick={() => setMessage(triage.draftApprove)}
            className="rounded-md bg-brand-100 px-2 py-1 text-brand-700 hover:bg-brand-200"
          >
            Use approve draft
          </button>
          <button
            onClick={() => setMessage(triage.draftDecline)}
            className="rounded-md bg-slate-100 px-2 py-1 text-slate-600 hover:bg-slate-200"
          >
            Use decline draft
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => act('approve')}
          disabled={busy}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={() => act('decline')}
          disabled={busy}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

function UpcomingTab() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api
      .meetings()
      .then((r) => setMeetings(r.meetings))
      .catch((e) => setError(String(e.message)))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function cancel(id: string) {
    if (!confirm('Cancel this confirmed meeting? The time will become available again.')) return;
    try {
      await api.cancel(id);
      load();
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  if (loading) return <p className="text-slate-500">Loading...</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return meetings.length === 0 ? (
    <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-500">
      No upcoming confirmed meetings.
    </p>
  ) : (
    <div className="space-y-3">
      {meetings.map((m) => (
        <div
          key={m.id}
          className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div>
            <p className="font-medium">{m.name}</p>
            <p className="text-sm text-slate-500">{m.email}</p>
            {m.note && <p className="mt-1 text-sm text-slate-600">{m.note}</p>}
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-slate-700">
              {formatDateTime(m.start)}
            </p>
            <p className="text-xs text-slate-400">{m.durationMinutes} min</p>
            <button
              onClick={() => cancel(m.id)}
              className="mt-1 text-xs text-red-600 underline hover:text-red-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AvailabilityTab({ config }: { config: AppConfig }) {
  const [avail, setAvail] = useState<Availability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [nlText, setNlText] = useState('');
  const [nlWindows, setNlWindows] = useState<WeeklyWindow[] | null>(null);
  const [nlWarnings, setNlWarnings] = useState<string[]>([]);
  const [nlMode, setNlMode] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  useEffect(() => {
    api.availability().then(setAvail).catch((e) => setError(String(e.message)));
  }, []);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!avail) return <p className="text-slate-500">Loading...</p>;

  function update(patch: Partial<Availability>) {
    setAvail((a) => (a ? { ...a, ...patch } : a));
    setSaved(false);
  }

  function setWindow(idx: number, patch: Partial<WeeklyWindow>) {
    if (!avail) return;
    const windows = avail.weeklyWindows.map((w, i) =>
      i === idx ? { ...w, ...patch } : w,
    );
    update({ weeklyWindows: windows });
  }

  function addWindow() {
    if (!avail) return;
    update({
      weeklyWindows: [...avail.weeklyWindows, { day: 1, start: '09:00', end: '17:00' }],
    });
  }

  function removeWindow(idx: number) {
    if (!avail) return;
    update({ weeklyWindows: avail.weeklyWindows.filter((_, i) => i !== idx) });
  }

  async function save() {
    if (!avail) return;
    setError(null);
    try {
      const result = await api.saveAvailability(avail);
      setAvail(result);
      setSaved(true);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  async function parseNl() {
    setParsing(true);
    try {
      const r = await api.parseAvailability(nlText);
      setNlWindows(r.windows);
      setNlWarnings(r.warnings);
      setNlMode(r.mode);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setParsing(false);
    }
  }

  function applyNl(mode: 'replace' | 'add') {
    if (!avail || !nlWindows) return;
    update({
      weeklyWindows:
        mode === 'replace'
          ? nlWindows
          : [...avail.weeklyWindows, ...nlWindows],
    });
    setNlWindows(null);
    setNlText('');
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold">Natural-language availability</h3>
        <p className="mt-1 text-sm text-slate-500">
          Describe when you are free and it will be parsed into weekly windows.
          {config.aiEnabled ? ' (AI)' : ' (rule-based)'}
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={nlText}
            onChange={(e) => setNlText(e.target.value)}
            placeholder="e.g. weekday afternoons 2 to 5"
            className="input"
          />
          <button
            onClick={parseNl}
            disabled={parsing || !nlText}
            className="whitespace-nowrap rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {parsing ? 'Parsing...' : 'Parse'}
          </button>
        </div>
        {nlWindows && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="text-xs text-slate-400">Parsed in {nlMode} mode:</p>
            {nlWindows.length === 0 ? (
              <p className="text-slate-500">No windows parsed.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {nlWindows.map((w, i) => (
                  <li key={i} className="text-slate-700">
                    {DAY_NAMES[w.day]} {w.start} to {w.end}
                  </li>
                ))}
              </ul>
            )}
            {nlWarnings.map((w, i) => (
              <p key={i} className="mt-1 text-xs text-amber-600">
                {w}
              </p>
            ))}
            {nlWindows.length > 0 && (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => applyNl('replace')}
                  className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
                >
                  Replace windows
                </button>
                <button
                  onClick={() => applyNl('add')}
                  className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Add to windows
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold">Settings</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Timezone (IANA)
            </span>
            <input
              value={avail.timezone}
              onChange={(e) => update({ timezone: e.target.value })}
              className="input"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Buffer between meetings (minutes)
            </span>
            <input
              type="number"
              min={0}
              value={avail.bufferMinutes}
              onChange={(e) => update({ bufferMinutes: Number(e.target.value) })}
              className="input"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Durations (comma separated minutes)
            </span>
            <input
              value={avail.durations.join(', ')}
              onChange={(e) =>
                update({
                  durations: e.target.value
                    .split(',')
                    .map((d) => Number(d.trim()))
                    .filter((d) => Number.isFinite(d) && d > 0),
                })
              }
              className="input"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Blackout dates (comma separated YYYY-MM-DD)
            </span>
            <input
              value={avail.blackoutDates.join(', ')}
              onChange={(e) =>
                update({
                  blackoutDates: e.target.value
                    .split(',')
                    .map((d) => d.trim())
                    .filter(Boolean),
                })
              }
              className="input"
            />
          </label>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">
              Weekly windows
            </span>
            <button
              onClick={addWindow}
              className="text-sm text-brand-700 underline hover:text-brand-800"
            >
              Add window
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {avail.weeklyWindows.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={w.day}
                  onChange={(e) => setWindow(i, { day: Number(e.target.value) })}
                  className="input w-28"
                >
                  {DAY_NAMES.map((name, d) => (
                    <option key={d} value={d}>
                      {name}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  value={w.start}
                  onChange={(e) => setWindow(i, { start: e.target.value })}
                  className="input w-32"
                />
                <span className="text-slate-400">to</span>
                <input
                  type="time"
                  value={w.end}
                  onChange={(e) => setWindow(i, { end: e.target.value })}
                  className="input w-32"
                />
                <button
                  onClick={() => removeWindow(i)}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            ))}
            {avail.weeklyWindows.length === 0 && (
              <p className="text-sm text-slate-400">
                No windows yet. Add one or use natural-language availability.
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={save}
            className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
          >
            Save availability
          </button>
          {saved && <span className="text-sm text-brand-700">Saved.</span>}
        </div>
      </div>
    </div>
  );
}
