/**
 * Google Calendar API wrappers for watch/stop operations
 */

import { google, calendar_v3 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { v4 as uuidv4 } from 'uuid';
import * as logger from './logger.js';
import { GaxiosError } from 'gaxios';

/**
 * Response from watchCalendarEvents
 */
export interface WatchResponse {
  channelId: string;
  resourceId: string;
  expiration: number | undefined;
}

/**
 * Map Google API errors to user-friendly messages with hints
 */
const handleCalendarError = (
  error: unknown,
  accountLabel: string,
  calendarId: string | undefined,
  operation: string
): never => {
  const err = error as GaxiosError;
  const status = err.response?.status;
  const calendarIdDisplay = calendarId || 'N/A';

  switch (status) {
    case 401:
      logger.errorWithHint(
        `[${accountLabel}] [${calendarIdDisplay}]: ${operation} failed - unauthorized`,
        'Invalid or expired credentials. Re-run auth command'
      );
      break;
    case 403:
      logger.errorWithHint(
        `[${accountLabel}] [${calendarIdDisplay}]: ${operation} failed - forbidden`,
        'Permission denied. Check calendar access'
      );
      break;
    case 404:
      logger.errorWithHint(
        `[${accountLabel}] [${calendarIdDisplay}]: ${operation} failed - not found`,
        'Channel not found. May already be stopped/expired'
      );
      break;
    case 429:
      logger.errorWithHint(
        `[${accountLabel}] [${calendarIdDisplay}]: ${operation} failed - rate limited`,
        'Rate limited. Retry after backoff'
      );
      break;
    default:
      if (status && status >= 500 && status < 600) {
        logger.errorWithHint(
          `[${accountLabel}] [${calendarIdDisplay}]: ${operation} failed - server error ${status}`,
          'Google API error. Retry later'
        );
      } else {
        logger.error(
          `[${accountLabel}] [${calendarIdDisplay}]: ${operation} failed - ${err.message}`
        );
      }
  }

  process.exit(1);
};

/**
 * Create a watch channel for calendar events
 * @param auth - Authorized OAuth2Client
 * @param calendarId - Calendar ID to watch
 * @param webhookUrl - HTTPS webhook endpoint URL
 * @returns Channel information from the API response
 */
export const watchCalendarEvents = async (
  auth: OAuth2Client,
  calendarId: string,
  webhookUrl: string
): Promise<WatchResponse> => {
  const calendar = google.calendar({ version: 'v3', auth });
  const channelId = uuidv4();

  try {
    const response = await calendar.events.watch({
      calendarId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
      },
    });

    return {
      channelId: response.data.id!,
      resourceId: response.data.resourceId!,
      expiration: response.data.expiration ? Number(response.data.expiration) : undefined,
    };
  } catch (error) {
    handleCalendarError(error, 'default', calendarId, 'Watch events');
  }
  return { channelId: '', resourceId: '', expiration: undefined };
};

/**
 * Stop a watch channel
 * @param auth - Authorized OAuth2Client
 * @param channelId - Channel ID to stop
 * @param resourceId - Resource ID associated with the channel
 */
export const stopChannel = async (
  auth: OAuth2Client,
  channelId: string,
  resourceId: string
): Promise<void> => {
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    await calendar.channels.stop({
      requestBody: {
        id: channelId,
        resourceId,
      },
    });
  } catch (error) {
    handleCalendarError(error, 'default', undefined, 'Stop channel');
  }
};
