/**
 * Refresh command for gcalendar-webhook-cli MVP
 * Refreshes expiring/expired webhooks for all configured calendars
 */

import type { Config, WebhookRecord, CalendarEntry } from '../types/index.js';
import { computeWebhookStatus } from '../types/index.js';
import { loadConfig } from '../lib/config.js';
import { listAccountLabels, readAccountState, writeAccountState } from '../lib/state.js';
import { getAuthorizedClient } from '../lib/google-auth.js';
import { watchCalendarEvents } from '../lib/calendar.js';
import { google } from 'googleapis';
import { GaxiosError } from 'gaxios';
import * as logger from '../lib/logger.js';

export interface RefreshOptions {
  config?: string;
  verbose?: boolean;
  force?: boolean;
}

/**
 * Find the calendar configuration entry for the given calendar_id in the account
 */
const findCalendarConfig = (
  config: Config,
  accountLabel: string,
  calendarId: string
): CalendarEntry | undefined => {
  const account = config.accounts.find((acc) => acc.label === accountLabel);
  if (!account) {
    return undefined;
  }

  return account.calendars.find((cal) => cal.calendar_id === calendarId);
};

/**
 * Attempt to stop a webhook channel gracefully
 * Returns true if successful (or channel already expired), false on retriable errors
 */
const stopChannelGracefully = async (
  accountLabel: string,
  webhook: WebhookRecord,
  config: Config
): Promise<boolean> => {
  try {
    const auth = await getAuthorizedClient(accountLabel, config);
    const calendar = google.calendar({ version: 'v3', auth });

    await calendar.channels.stop({
      requestBody: {
        id: webhook.channel_id,
        resourceId: webhook.resource_id,
      },
    });

    logger.debug(`[${accountLabel}] [${webhook.calendar_id}]: Channel stopped successfully via API`);
    return true;
  } catch (error) {
    const err = error as GaxiosError;
    const status = err.response?.status;

    // Handle 404/410 gracefully - channel already expired or doesn't exist
    if (status === 404 || status === 410) {
      logger.warn(
        `[${accountLabel}] [${webhook.calendar_id}]: Channel not found or already expired (HTTP ${status}). Proceeding with refresh.`
      );
      return true;
    }

    // For other errors, warn and proceed
    logger.warn(
      `[${accountLabel}] [${webhook.calendar_id}]: Failed to stop channel (${err.message}). Proceeding with refresh.`
    );
    return true;
  }
};

/**
 * Refresh a single webhook for a calendar
 * Returns true on success, false on failure
 */
export const refreshWebhook = async (
  accountLabel: string,
  webhook: WebhookRecord,
  config: Config
): Promise<boolean> => {
  logger.debug(`[${accountLabel}] [${webhook.calendar_id}]: Starting webhook refresh`);

  const calendarConfig = findCalendarConfig(config, accountLabel, webhook.calendar_id);
  if (!calendarConfig) {
    logger.error(
      `[${accountLabel}] [${webhook.calendar_id}]: Calendar not found in configuration. Cannot refresh webhook.`
    );
    return false;
  }

  // Get authorized client
  let auth;
  try {
    auth = await getAuthorizedClient(accountLabel, config);
  } catch (error) {
    logger.error(
      `[${accountLabel}] [${webhook.calendar_id}]: Failed to get authorized client: ${(error as Error).message}`
    );
    return false;
  }

  // Create new channel via watchCalendarEvents
  logger.debug(`[${accountLabel}] [${webhook.calendar_id}]: Creating new webhook channel`);
  let watchResponse;
  try {
    watchResponse = await watchCalendarEvents(
      auth,
      webhook.calendar_id,
      calendarConfig.webhook_url
    );
  } catch (error) {
    logger.error(
      `[${accountLabel}] [${webhook.calendar_id}]: Failed to create new webhook: ${(error as Error).message}`
    );
    return false;
  }

  // Write new record with channel_id, resource_id, expiration
  const now = Date.now();
  const newWebhook: WebhookRecord = {
    channel_id: watchResponse.channelId,
    resource_id: watchResponse.resourceId,
    calendar_id: webhook.calendar_id,
    account_label: accountLabel,
    webhook_url: calendarConfig.webhook_url,
    expiration: watchResponse.expiration ?? now + (7 * 24 * 60 * 60 * 1000), // Default 7 days
    created_at: now,
  };

  const updatedState = readAccountState(accountLabel);
  updatedState.webhooks = updatedState.webhooks.filter(
    (w) => w.calendar_id !== webhook.calendar_id
  );
  updatedState.webhooks.push(newWebhook);
  writeAccountState(accountLabel, updatedState);

  logger.debug(`[${accountLabel}] [${webhook.calendar_id}]: New webhook record saved to state`);

  await stopChannelGracefully(accountLabel, webhook, config);

  logger.log(
    `✓ [${accountLabel}] [${webhook.calendar_id}]: Webhook refreshed successfully`
  );
  logger.log(`    New Channel ID:   ${watchResponse.channelId}`);
  logger.log(`    New Resource ID:  ${watchResponse.resourceId}`);
  if (watchResponse.expiration) {
    logger.log(`    New Expiration:   ${new Date(watchResponse.expiration).toISOString()}`);
  }

  return true;
};

/**
 * Execute the refresh command
 */
export const refreshCommand = async (options: RefreshOptions): Promise<void> => {
  // Set verbose mode
  if (options.verbose) {
    logger.setVerbose(true);
  }

  logger.debug(`Refresh command started with options: ${JSON.stringify(options)}`);

  // Load configuration
  let config: Config;
  try {
    config = loadConfig({ path: options.config });
    logger.debug(`Configuration loaded from ${options.config ?? './gcalendar-webhooks.yaml'}`);
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(1);
  }

  // List all account labels from state files
  const accountLabels = listAccountLabels();
  if (accountLabels.length === 0) {
    logger.log('No webhook state files found. Nothing to refresh.');
    logger.debug('Refresh command completed - no accounts found');
    process.exit(0);
  }

  logger.debug(`Found ${accountLabels.length} account(s) with state files: ${accountLabels.join(', ')}`);

  const thresholdMs = 3 * 24 * 60 * 60 * 1000; // 3 days in milliseconds
  const now = Date.now();

  let totalWebhooks = 0;
  let needsRefresh = 0;
  let failures = 0;

  // Process each account
  for (const accountLabel of accountLabels) {
    const state = readAccountState(accountLabel);
    
    if (state.webhooks.length === 0) {
      logger.debug(`[${accountLabel}]: No webhooks found in state`);
      continue;
    }

    logger.debug(`[${accountLabel}]: Processing ${state.webhooks.length} webhook(s)`);

    // Process each webhook
    for (const webhook of state.webhooks) {
      totalWebhooks++;
      
      const status = computeWebhookStatus(webhook.expiration);
      const timeUntilExpiration = webhook.expiration - now;

      logger.debug(
        `[${accountLabel}] [${webhook.calendar_id}]: Status=${status}, ` +
        `Expiration=${new Date(webhook.expiration).toISOString()}, ` +
        `TimeUntilExpiration=${Math.floor(timeUntilExpiration / 1000 / 60 / 60)}h`
      );

      // Handle webhooks with no expiration (should not happen, but handle gracefully)
      if (webhook.expiration === undefined) {
        logger.warn(
          `[${accountLabel}] [${webhook.calendar_id}]: Webhook has no expiration timestamp. Refreshing as precaution.`
        );
        needsRefresh++;
        const success = await refreshWebhook(accountLabel, webhook, config);
        if (!success) {
          failures++;
        }
        continue;
      }

      // Skip if expiration > 3 days from now (unless --force is set)
      if (!options.force && timeUntilExpiration > thresholdMs) {
        logger.debug(
          `[${accountLabel}] [${webhook.calendar_id}]: Webhook is active, no refresh needed ` +
          `(expires in ${Math.floor(timeUntilExpiration / 1000 / 60 / 60)}h)`
        );
        continue;
      }

      // Refresh if expired or expiring within 3 days (or --force)
      needsRefresh++;
      if (options.force && timeUntilExpiration > thresholdMs) {
        logger.log(
          `[${accountLabel}] [${webhook.calendar_id}]: Force-refreshing webhook...`
        );
      } else {
        logger.log(
          `[${accountLabel}] [${webhook.calendar_id}]: Webhook ${status}, refreshing...`
        );
      }
      
      const success = await refreshWebhook(accountLabel, webhook, config);
      if (!success) {
        failures++;
      }
    }
  }

  // Summary
  logger.log('');
  logger.log('=== Refresh Summary ===');
  logger.log(`Total webhooks:       ${totalWebhooks}`);
  logger.log(`Refreshed:            ${needsRefresh}`);
  logger.log(`Failures:             ${failures}`);
  logger.log(`Already up-to-date:   ${totalWebhooks - needsRefresh}`);

  logger.debug('Refresh command completed');

  // Exit with appropriate code
  if (failures > 0) {
    logger.error(`${failures} webhook(s) failed to refresh. Check logs for details.`);
    process.exit(1);
  }

  if (needsRefresh === 0) {
    logger.log('✓ All webhooks are up-to-date.');
  } else {
    logger.log('✓ All webhooks refreshed successfully.');
  }

  process.exit(0);
};
