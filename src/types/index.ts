/**
 * Domain entities for gcalendar-webhook-cli MVP
 * Strict TypeScript types with no `any` usage
 */

/**
 * OAuth token stored at ~/.gcalendar-webhook-cli/accounts/<label>.json
 */
export interface OAuthToken {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number | undefined;
  scope: string;
}

/**
 * Calendar entry within an account
 */
export interface CalendarEntry {
  calendar_id: string;
  webhook_url: string; // HTTPS required
}

/**
 * Account configuration with associated calendars
 */
export interface Account {
  label: string;
  calendars: CalendarEntry[];
}

/**
 * Root configuration file
 */
export interface Config {
  credentials_path: string;
  accounts: Account[];
}

/**
 * Webhook record stored at ~/.gcalendar-webhook-cli/state/<label>.json
 */
export interface WebhookRecord {
  channel_id: string;
  resource_id: string;
  calendar_id: string;
  account_label: string;
  webhook_url: string;
  expiration: number; // Unix milliseconds
  created_at: number; // Unix milliseconds
}

/**
 * Container for webhook state file
 */
export interface WebhookStateFile {
  account_label: string;
  webhooks: WebhookRecord[];
}

/**
 * Computed webhook status based on expiration time
 */
export type WebhookStatus = 'active' | 'expiring' | 'expired';

/**
 * Compute webhook status based on expiration timestamp
 * @param expiration - Unix milliseconds timestamp (or undefined)
 * @returns WebhookStatus: 'expired' if past, 'expiring' if within 3 days, 'active' otherwise
 */
export function computeWebhookStatus(
  expiration: number | undefined
): WebhookStatus {
  if (expiration === undefined) {
    return 'active';
  }

  const now = Date.now();
  const thresholdMs = 3 * 24 * 60 * 60 * 1000; // 3 days in milliseconds

  if (expiration <= now) {
    return 'expired';
  }

  if (expiration - now <= thresholdMs) {
    return 'expiring';
  }

  return 'active';
}
