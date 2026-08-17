// Repository abstraction over persistence. `FileStore` is the file-backed JSON
// implementation used in production so availability, requests, and meetings
// survive restarts. `MemoryStore` is an in-memory implementation used by tests.
//
// Upgrade path: implement this same `Store` interface against Supabase/Postgres
// (see README) without touching the service or HTTP layers.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Availability, Meeting, MeetingRequest } from './types.js';

export const DEFAULT_AVAILABILITY: Availability = {
  timezone: 'America/Los_Angeles',
  weeklyWindows: [
    { day: 1, start: '09:00', end: '17:00' },
    { day: 2, start: '09:00', end: '17:00' },
    { day: 3, start: '09:00', end: '17:00' },
    { day: 4, start: '09:00', end: '17:00' },
    { day: 5, start: '09:00', end: '17:00' },
  ],
  durations: [30, 60],
  bufferMinutes: 15,
  blackoutDates: [],
};

export interface Store {
  getAvailability(): Availability;
  saveAvailability(a: Availability): Availability;

  listRequests(status?: string): MeetingRequest[];
  getRequest(id: string): MeetingRequest | undefined;
  createRequest(r: MeetingRequest): MeetingRequest;
  updateRequest(r: MeetingRequest): MeetingRequest;

  listMeetings(status?: string): Meeting[];
  getMeeting(id: string): Meeting | undefined;
  createMeeting(m: Meeting): Meeting;
  updateMeeting(m: Meeting): Meeting;
}

interface Snapshot {
  availability: Availability;
  requests: MeetingRequest[];
  meetings: Meeting[];
}

function emptySnapshot(): Snapshot {
  return {
    availability: structuredClone(DEFAULT_AVAILABILITY),
    requests: [],
    meetings: [],
  };
}

export class MemoryStore implements Store {
  protected data: Snapshot;

  constructor(initial?: Partial<Snapshot>) {
    this.data = { ...emptySnapshot(), ...initial };
  }

  protected persist(): void {
    // No-op for the in-memory store.
  }

  getAvailability(): Availability {
    return structuredClone(this.data.availability);
  }

  saveAvailability(a: Availability): Availability {
    this.data.availability = structuredClone(a);
    this.persist();
    return this.getAvailability();
  }

  listRequests(status?: string): MeetingRequest[] {
    const all = this.data.requests;
    const filtered = status ? all.filter((r) => r.status === status) : all;
    return structuredClone(
      [...filtered].sort((a, b) => a.start.localeCompare(b.start)),
    );
  }

  getRequest(id: string): MeetingRequest | undefined {
    const found = this.data.requests.find((r) => r.id === id);
    return found ? structuredClone(found) : undefined;
  }

  createRequest(r: MeetingRequest): MeetingRequest {
    this.data.requests.push(structuredClone(r));
    this.persist();
    return structuredClone(r);
  }

  updateRequest(r: MeetingRequest): MeetingRequest {
    const idx = this.data.requests.findIndex((x) => x.id === r.id);
    if (idx === -1) throw new Error(`Request not found: ${r.id}`);
    this.data.requests[idx] = structuredClone(r);
    this.persist();
    return structuredClone(r);
  }

  listMeetings(status?: string): Meeting[] {
    const all = this.data.meetings;
    const filtered = status ? all.filter((m) => m.status === status) : all;
    return structuredClone(
      [...filtered].sort((a, b) => a.start.localeCompare(b.start)),
    );
  }

  getMeeting(id: string): Meeting | undefined {
    const found = this.data.meetings.find((m) => m.id === id);
    return found ? structuredClone(found) : undefined;
  }

  createMeeting(m: Meeting): Meeting {
    this.data.meetings.push(structuredClone(m));
    this.persist();
    return structuredClone(m);
  }

  updateMeeting(m: Meeting): Meeting {
    const idx = this.data.meetings.findIndex((x) => x.id === m.id);
    if (idx === -1) throw new Error(`Meeting not found: ${m.id}`);
    this.data.meetings[idx] = structuredClone(m);
    this.persist();
    return structuredClone(m);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class FileStore extends MemoryStore {
  private file: string;

  constructor(dataDir?: string) {
    const dir = dataDir ?? path.join(__dirname, 'data');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'store.json');
    let initial: Partial<Snapshot> | undefined;
    if (fs.existsSync(file)) {
      try {
        initial = JSON.parse(fs.readFileSync(file, 'utf8')) as Snapshot;
      } catch {
        initial = undefined;
      }
    }
    super(initial);
    this.file = file;
    // Write an initial snapshot so the file exists on disk.
    this.persist();
  }

  protected override persist(): void {
    // `persist` runs from the base constructor before `this.file` is set;
    // guard against that first call.
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
