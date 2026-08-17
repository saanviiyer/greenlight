// Shared domain types for the Greenlight server.

export interface WeeklyWindow {
  day: number; // 0 = Sunday ... 6 = Saturday
  start: string; // "HH:MM" wall-clock in the owner timezone
  end: string; // "HH:MM" wall-clock in the owner timezone
}

export interface Availability {
  timezone: string; // IANA timezone, e.g. "America/Los_Angeles"
  weeklyWindows: WeeklyWindow[];
  durations: number[]; // offered meeting durations in minutes
  bufferMinutes: number; // gap enforced around each confirmed meeting
  blackoutDates: string[]; // "YYYY-MM-DD" dates with no availability
}

export type RequestStatus = 'pending' | 'approved' | 'declined';

export interface MeetingRequest {
  id: string;
  name: string;
  email: string;
  note: string;
  start: string; // ISO 8601 UTC instant
  end: string; // ISO 8601 UTC instant
  durationMinutes: number;
  status: RequestStatus;
  createdAt: string;
  decidedAt?: string;
  decisionMessage?: string;
}

export type MeetingStatus = 'confirmed' | 'cancelled';

export interface Meeting {
  id: string;
  requestId: string;
  name: string;
  email: string;
  note: string;
  start: string; // ISO 8601 UTC instant
  end: string; // ISO 8601 UTC instant
  durationMinutes: number;
  status: MeetingStatus;
  createdAt: string;
  cancelledAt?: string;
}

export interface Slot {
  start: string; // ISO 8601 UTC instant
  end: string; // ISO 8601 UTC instant
  durationMinutes: number;
}

export interface TriageResult {
  id: string;
  priority: 'high' | 'medium' | 'low';
  summary: string;
  flags: string[];
  draftApprove: string;
  draftDecline: string;
}
