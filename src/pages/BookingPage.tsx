import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AppConfig, Slot } from '../types';
import { dayKey, formatTime, localTimeZone } from '../lib/time';

type Submitted = { id: string; status: string };

export function BookingPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [duration, setDuration] = useState<number>(30);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Slot | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    api
      .config()
      .then((c) => {
        setConfig(c);
        setDuration(c.durations[0] ?? 30);
      })
      .catch((e) => setError(String(e.message)));
  }, []);

  useEffect(() => {
    if (!config) return;
    setLoading(true);
    setError(null);
    api
      .slots(duration)
      .then((r) => setSlots(r.slots))
      .catch((e) => setError(String(e.message)))
      .finally(() => setLoading(false));
  }, [config, duration]);

  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const key = dayKey(s.start);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()];
  }, [slots]);

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await api.createRequest({
        name,
        email,
        note,
        start: selected.start,
        durationMinutes: selected.durationMinutes,
      });
      setSubmitted({ id: res.id, status: res.status });
    } catch (e) {
      setFormError(String((e as Error).message));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setSubmitted(null);
    setSelected(null);
    setName('');
    setEmail('');
    setNote('');
    // refresh slots so a just-requested slot list stays current
    api.slots(duration).then((r) => setSlots(r.slots)).catch(() => {});
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-2xl text-brand-700">
          ✓
        </div>
        <h2 className="text-xl font-semibold">Request sent</h2>
        <p className="mt-2 text-slate-600">
          Your request is pending approval. You will be notified when the owner
          approves or declines it.
        </p>
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Request id: <span className="font-mono text-slate-700">{submitted.id}</span>
        </p>
        <StatusLookup id={submitted.id} initialStatus={submitted.status} />
        <button
          onClick={reset}
          className="mt-6 rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
        >
          Book another time
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_360px]">
      <section>
        <h1 className="text-2xl font-semibold">Request a meeting</h1>
        <p className="mt-1 text-slate-600">
          Pick an open time and send a request. The owner reviews every request
          before it is confirmed.
        </p>

        <div className="mt-4 flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">Duration</label>
          <div className="flex gap-1">
            {(config?.durations ?? [30]).map((d) => (
              <button
                key={d}
                onClick={() => {
                  setDuration(d);
                  setSelected(null);
                }}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  duration === d
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {d} min
              </button>
            ))}
          </div>
        </div>

        <p className="mt-2 text-xs text-slate-400">
          Times shown in your timezone ({localTimeZone()}).
          {config ? ` Owner timezone: ${config.timezone}.` : ''}
        </p>

        <div className="mt-4 space-y-5">
          {loading && <p className="text-slate-500">Loading available times...</p>}
          {error && <p className="text-red-600">{error}</p>}
          {!loading && !error && grouped.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-500">
              No open times in the next two weeks. Please check back later.
            </p>
          )}
          {grouped.map(([day, daySlots]) => (
            <div key={day}>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">{day}</h3>
              <div className="flex flex-wrap gap-2">
                {daySlots.map((s) => (
                  <button
                    key={s.start}
                    onClick={() => setSelected(s)}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      selected?.start === s.start
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-brand-400'
                    }`}
                  >
                    {formatTime(s.start)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <aside className="h-fit rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Your request</h2>
        {!selected ? (
          <p className="mt-2 text-sm text-slate-500">
            Select an open time to continue.
          </p>
        ) : (
          <>
            <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
              {dayKey(selected.start)} at {formatTime(selected.start)} ({selected.durationMinutes} min)
            </p>
            <div className="mt-4 space-y-3">
              <Field label="Name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input"
                  placeholder="Your name"
                />
              </Field>
              <Field label="Email">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input"
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Reason for meeting">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="input h-24 resize-none"
                  placeholder="What would you like to discuss?"
                />
              </Field>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <button
                onClick={submit}
                disabled={submitting || !name || !email}
                className="w-full rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {submitting ? 'Sending...' : 'Send request'}
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function StatusLookup({ id, initialStatus }: { id: string; initialStatus: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [message, setMessage] = useState<string | undefined>();
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      const r = await api.requestStatus(id);
      setStatus(r.status);
      setMessage(r.decisionMessage);
    } finally {
      setChecking(false);
    }
  }

  const color =
    status === 'approved'
      ? 'text-brand-700'
      : status === 'declined'
        ? 'text-red-600'
        : 'text-amber-600';

  return (
    <div className="mt-4 text-sm">
      <p>
        Status: <span className={`font-semibold ${color}`}>{status}</span>
      </p>
      {message && <p className="mt-1 text-slate-500">Message: {message}</p>}
      <button
        onClick={check}
        className="mt-2 text-brand-700 underline hover:text-brand-800"
      >
        {checking ? 'Checking...' : 'Refresh status'}
      </button>
    </div>
  );
}
