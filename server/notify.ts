// Notification hook. In-app status is the source of truth; email delivery is
// stubbed here. To send real email, wire an SMTP or transactional-email
// provider into `sendNotification` (see README "Upgrade path").

export interface Notification {
  type:
    | 'request.created'
    | 'request.approved'
    | 'request.declined'
    | 'meeting.cancelled';
  to: string;
  subject: string;
  body: string;
}

export function sendNotification(n: Notification): void {
  // STUB: log the notification. A real implementation would deliver by email.
  console.log(
    `[notify] ${n.type} -> ${n.to} | ${n.subject}\n         ${n.body}`,
  );
}
