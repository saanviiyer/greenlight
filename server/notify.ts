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
  // Avoid putting request reasons and full addresses into production logs.
  const [local = '', domain = ''] = n.to.split('@');
  const recipient = n.to === 'owner' ? 'owner' : `${local.slice(0, 1)}***@${domain}`;
  const detail = process.env.LOG_NOTIFICATION_BODIES === '1' ? `\n         ${n.body}` : '';
  console.log(`[notify] ${n.type} -> ${recipient} | ${n.subject}${detail}`);
}
