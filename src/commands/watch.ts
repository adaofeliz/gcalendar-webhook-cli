/**
 * Watch command for gcalendar-webhook-cli MVP
 * Creates a webhook channel for a calendar and stores the channel info
 */

import type { Config, WebhookRecord, CalendarEntry } from '../types/index.js';
import { loadConfig } from '../lib/config.js';
import { readAccountState, writeAccountState } from '../lib/state.js';
import { getAuthorizedClient } from '../lib/google-auth.js';
import { watchCalendarEvents } from '../lib/calendar.js';
import * as logger from '../lib/logger.js';

export interface WatchOptions {
  account: string;
  calendar: string;
  config?: string;
  verbose?: boolean;
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
 * Check if a webhook already exists for the given calendar
 */
const findExistingWebhook = (
  accountLabel: string,
  calendarId: string
): WebhookRecord | undefined => {
  const state = readAccountState(accountLabel);
  return state.webhooks.find((webhook) => webhook.calendar_id === calendarId);
};

/**
 * Execute the watch command
 */
export const watchCommand = async (options: WatchOptions): Promise<void> => {
  // Set verbose mode
  if (options.verbose) {
    logger.setVerbose(true);
  }

  logger.debug(`Watch command started with options: ${JSON.stringify(options)}`);

  // Load configuration
  let config: Config;
  try {
    config = loadConfig({ path: options.config });
    logger.debug(`Configuration loaded from ${options.config ?? './gcalendar-webhooks.yaml'}`);
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(1);
  }

  // Validate account exists
  const account = config.accounts.find((acc) => acc.label === options.account);
  if (!account) {
    logger.error(
      `Account "${options.account}" not found in configuration.\n` +
      `Available accounts: ${config.accounts.map((acc) => acc.label).join(', ')}`
    );
    process.exit(1);
  }

  logger.debug(`Account "${options.account}" found in configuration`);

  // Validate calendar exists in account's configuration
  const calendarConfig = findCalendarConfig(config, options.account, options.calendar);
  if (!calendarConfig) {
    logger.error(
      `Calendar "${options.calendar}" not found in account "${options.account}" configuration.\n` +
      `Available calendars for "${options.account}": ${account.calendars.map((cal) => cal.calendar_id).join(', ')}`
    );
    process.exit(1);
  }

  logger.debug(`Calendar "${options.calendar}" found in account configuration`);
  logger.debug(`Webhook URL: ${calendarConfig.webhook_url}`);

  // Check for existing webhook (warn, don't error)
  const existingWebhook = findExistingWebhook(options.account, options.calendar);
  if (existingWebhook) {
    logger.warn(
      `A webhook already exists for calendar "${options.calendar}" in account "${options.account}".\n` +
      `  Channel ID: ${existingWebhook.channel_id}\n` +
      `  Resource ID: ${existingWebhook.resource_id}\n` +
      `  Expiration: ${new Date(existingWebhook.expiration).toISOString()}\n` +
      `Proceeding to create a new webhook anyway.`
    );
  }

  // Get authorized client
  logger.debug(`Getting authorized client for account "${options.account}"`);
  const auth = await getAuthorizedClient(options.account, config);

  // Create webhook channel
  logger.debug(`Creating webhook channel for calendar "${options.calendar}"`);
  let watchResponse;
  try {
    watchResponse = await watchCalendarEvents(
      auth,
      options.calendar,
      calendarConfig.webhook_url
    );
  } catch (error) {
    logger.error(`Failed to create webhook: ${(error as Error).message}`);
    process.exit(1);
  }

  logger.debug(`Webhook created: ${JSON.stringify(watchResponse)}`);

  // Create webhook record
  const now = Date.now();
  const newWebhook: WebhookRecord = {
    channel_id: watchResponse.channelId,
    resource_id: watchResponse.resourceId,
    calendar_id: options.calendar,
    account_label: options.account,
    webhook_url: calendarConfig.webhook_url,
    expiration: watchResponse.expiration ?? now + (7 * 24 * 60 * 60 * 1000), // Default 7 days if not provided
    created_at: now,
  };

  // Store webhook record in state
  const state = readAccountState(options.account);
  state.webhooks.push(newWebhook);
  writeAccountState(options.account, state);

  logger.debug(`Webhook record saved to state file`);

  // Output success message
  logger.log('✓ Webhook channel created successfully');
  logger.log(`  Account:      ${options.account}`);
  logger.log(`  Calendar ID:  ${options.calendar}`);
  logger.log(`  Channel ID:   ${watchResponse.channelId}`);
  logger.log(`  Resource ID:  ${watchResponse.resourceId}`);
  logger.log(`  Webhook URL:  ${calendarConfig.webhook_url}`);
  
  if (watchResponse.expiration) {
    const expirationDate = new Date(watchResponse.expiration);
    logger.log(`  Expiration:   ${expirationDate.toISOString()}`);
  } else {
    logger.log(`  Expiration:   (not provided by API, estimated ~7 days)`);
  }

  logger.debug('Watch command completed successfully');
};
