/**
 * Maps Meta WhatsApp message statuses into the framework's normalized delivery
 * states. Unknown/future statuses degrade to `null` (safely ignored) so new Meta
 * statuses never require an architecture change.
 */
export type NormalizedWhatsAppStatus =
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

export function mapWhatsAppStatus(
  status: string | undefined | null,
): NormalizedWhatsAppStatus | null {
  switch (status) {
    // Meta's "accepted" (message accepted by WhatsApp) maps to our SENT.
    case 'accepted':
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
      return 'failed';
    // "deleted" and any future/unknown status are not modeled — ignore safely.
    default:
      return null;
  }
}
