export interface WeeklyWindow {
  day: number;
  start: string;
  end: string;
}

export interface Availability {
  timezone: string;
  weeklyWindows: WeeklyWindow[];
  durations: number[];
  bufferMinutes: number;
  blackoutDates: string[];
}

export type RequestStatus = 'pending' | 'approved' | 'declined';

export interface MeetingRequest {
  id: string;
  statusToken: string;
  name: string;
  email: string;
  note: string;
  start: string;
  end: string;
  durationMinutes: number;
  status: RequestStatus;
  createdAt: string;
  decidedAt?: string;
  decisionMessage?: string;
}

export interface Meeting {
  id: string;
  requestId: string;
  name: string;
  email: string;
  note: string;
  start: string;
  end: string;
  durationMinutes: number;
  status: 'confirmed' | 'cancelled';
  createdAt: string;
}

export interface Slot {
  start: string;
  end: string;
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

export interface AppConfig {
  aiEnabled: boolean;
  ownerProtected: boolean;
  timezone: string;
  durations: number[];
  bookingHorizonDays: number;
  minNoticeMinutes: number;
}
