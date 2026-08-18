import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Availability, Meeting, MeetingRequest } from './types.js';

export const DEFAULT_AVAILABILITY: Availability = {
  timezone: 'America/Los_Angeles',
  weeklyWindows: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
  durations: [30, 60], bufferMinutes: 15, blackoutDates: [],
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
  transaction<T>(action: () => T): T;
}

interface Snapshot { availability: Availability; requests: MeetingRequest[]; meetings: Meeting[] }
function emptySnapshot(): Snapshot {
  return { availability: structuredClone(DEFAULT_AVAILABILITY), requests: [], meetings: [] };
}

export class MemoryStore implements Store {
  protected data: Snapshot;
  private transactionDepth = 0;
  constructor(initial?: Partial<Snapshot>) {
    this.data = { ...emptySnapshot(), ...structuredClone(initial ?? {}) };
  }
  protected persist(): void {}
  private changed(): void { if (this.transactionDepth === 0) this.persist(); }
  transaction<T>(action: () => T): T {
    if (this.transactionDepth > 0) return action();
    const before = structuredClone(this.data);
    this.transactionDepth += 1;
    try {
      const result = action();
      this.transactionDepth -= 1;
      this.persist();
      return result;
    } catch (error) {
      this.data = before;
      this.transactionDepth -= 1;
      throw error;
    }
  }
  getAvailability(): Availability { return structuredClone(this.data.availability); }
  saveAvailability(value: Availability): Availability {
    this.data.availability = structuredClone(value); this.changed(); return this.getAvailability();
  }
  listRequests(status?: string): MeetingRequest[] {
    const values = status ? this.data.requests.filter((item) => item.status === status) : this.data.requests;
    return structuredClone([...values].sort((a, b) => a.start.localeCompare(b.start)));
  }
  getRequest(id: string): MeetingRequest | undefined {
    const value = this.data.requests.find((item) => item.id === id); return value ? structuredClone(value) : undefined;
  }
  createRequest(value: MeetingRequest): MeetingRequest {
    if (this.data.requests.some((item) => item.id === value.id)) throw new Error(`Duplicate request id: ${value.id}`);
    this.data.requests.push(structuredClone(value)); this.changed(); return structuredClone(value);
  }
  updateRequest(value: MeetingRequest): MeetingRequest {
    const index = this.data.requests.findIndex((item) => item.id === value.id);
    if (index === -1) throw new Error(`Request not found: ${value.id}`);
    this.data.requests[index] = structuredClone(value); this.changed(); return structuredClone(value);
  }
  listMeetings(status?: string): Meeting[] {
    const values = status ? this.data.meetings.filter((item) => item.status === status) : this.data.meetings;
    return structuredClone([...values].sort((a, b) => a.start.localeCompare(b.start)));
  }
  getMeeting(id: string): Meeting | undefined {
    const value = this.data.meetings.find((item) => item.id === id); return value ? structuredClone(value) : undefined;
  }
  createMeeting(value: Meeting): Meeting {
    if (this.data.meetings.some((item) => item.id === value.id)) throw new Error(`Duplicate meeting id: ${value.id}`);
    this.data.meetings.push(structuredClone(value)); this.changed(); return structuredClone(value);
  }
  updateMeeting(value: Meeting): Meeting {
    const index = this.data.meetings.findIndex((item) => item.id === value.id);
    if (index === -1) throw new Error(`Meeting not found: ${value.id}`);
    this.data.meetings[index] = structuredClone(value); this.changed(); return structuredClone(value);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export class FileStore extends MemoryStore {
  private file: string;
  constructor(dataDir?: string) {
    const dir = dataDir ?? process.env.DATA_DIR ?? path.join(__dirname, 'data');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'store.json');
    const existed = fs.existsSync(file);
    let initial: Partial<Snapshot> | undefined;
    if (existed) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Snapshot>;
        if (!parsed.availability || !Array.isArray(parsed.availability.weeklyWindows) || !Array.isArray(parsed.requests) || !Array.isArray(parsed.meetings)) throw new Error('snapshot schema is invalid');
        initial = parsed;
      } catch (error) {
        throw new Error(`Greenlight data at ${file} is corrupt; refusing to overwrite it. Restore ${file}.bak or repair the file. Cause: ${(error as Error).message}`);
      }
    }
    super(initial); this.file = file;
    if (!existed) this.persist();
  }
  protected override persist(): void {
    if (!this.file) return;
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(temporary, this.file);
  }
}
