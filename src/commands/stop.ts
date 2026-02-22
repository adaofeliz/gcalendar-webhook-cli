/**
 * Stop command for gcalendar-webhook-cli MVP
 * Stops a webhook channel for a calendar and removes the channel info from state
 */

import type { Config, WebhookRecord } from '../types/index.js';
import { loadConfig } from '../lib/config.js';
import { readAccountState, writeAccountState } from '../lib/state.js';
import { getAuthorizedClient } from '../lib/google-auth.js';
import { google } from 'googleapis';
import { GaxiosError } from 'gaxios';
import * as logger from '../lib/logger.js';

export interface StopOptions {
  account: string;
  calendar: string;
  config?: string;
  verbose?: boolean;
}

/**
 * Find the webhook record for the given calendar
 */
const findWebhookRecord = (
  accountLabel: string,
  calendarId: string
): WebhookRecord | undefined => {
  const state = readAccountState(accountLabel);
  return state.webhooks.find((webhook) => webhook.calendar_id === calendarId);
};

/**
 * Remove webhook record from state
 */
const removeWebhookRecord = (
  accountLabel: string,
  calendarId: string
): void => {
  const state = readAccountState(accountLabel);
  state.webhooks = state.webhooks.filter(
    (webhook) => webhook.calendar_id !== calendarId
  );
  writeAccountState(accountLabel, state);
};

/**
 * Execute the stop command
 */
export const stopCommand = async (options: StopOptions): Promise<void> => {
  if (options.verbose) {
    logger.setVerbose(true);
  }

  logger.debug(`Stop command started with options: ${JSON.stringify(options)}`);

  let config: Config;
  try {
    config = loadConfig({ path: options.config });
    logger.debug(`Configuration loaded from ${options.config ?? './gcalendar-webhooks.yaml'}`);
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(1);
  }

  const account = config.accounts.find((acc) => acc.label === options.account);
  if (!account) {
    logger.error(
      `Account "${options.account}" not found in configuration.\n` +
      `Available accounts: ${config.accounts.map((acc) => acc.label).join(', ')}`
    );
    process.exit(1);
  }

  logger.debug(`Account "${options.account}" found in configuration`);

  const webhookRecord = findWebhookRecord(options.account, options.calendar);
  if (!webhookRecord) {
    logger.errorWithHint(
      `No webhook record found for calendar "${options.calendar}" in account "${options.account}"`,
      `No active webhook exists for this calendar. Use 'watch' command to create one`
    );
    process.exit(1);
  }

  logger.debug(`Webhook record found for calendar "${options.calendar}"`);
  logger.debug(`  Channel ID: ${webhookRecord.channel_id}`);
  logger.debug(`  Resource ID: ${webhookRecord.resource_id}`);

  logger.debug(`Getting authorized client for account "${options.account}"`);
  const auth = await getAuthorizedClient(options.account, config);

  // Stop the channel - handle errors without process.exit
  const calendar = google.calendar({ version: 'v3', auth });
  
  try {
    await calendar.channels.stop({
      requestBody: {
        id: webhookRecord.channel_id,
        resourceId: webhookRecord.resource_id,
      },
    });

    logger.debug(`Channel stopped successfully via API`);
    
    removeWebhookRecord(options.account, options.calendar);
    
    logger.log('✓ Webhook channel stopped successfully');
    logger.log(`  Account:      ${options.account}`);
    logger.log(`  Calendar ID:  ${options.calendar}`);
    logger.log(`  Channel ID:   ${webhookRecord.channel_id}`);
    logger.log(`  Resource ID:  ${webhookRecord.resource_id}`);
    
  } catch (error) {
    const err = error as GaxiosError;
    const status = err.response?.status;

    // Handle 404/410 gracefully - channel already expired or doesn't exist
    if (status === 404 || status === 410) {
      logger.warn(
        `Channel not found or already expired (HTTP ${status}). Removing from local state anyway.`
      );
      
      removeWebhookRecord(options.account, options.calendar);
      
      logger.log('✓ Webhook record removed from state');
      logger.log(`  Account:      ${options.account}`);
      logger.log(`  Calendar ID:  ${options.calendar}`);
      logger.log(`  Channel ID:   ${webhookRecord.channel_id}`);
      logger.log(`  Resource ID:  ${webhookRecord.resource_id}`);
      
      logger.debug('Stop command completed with warning (channel already expired)');
      return;
    }

    // Handle retriable errors - keep record for retry
    if (status === 401) {
      logger.errorWithHint(
        `Stop channel failed - unauthorized (HTTP 401)`,
        `Invalid or expired credentials. Re-run auth command. Webhook record kept for retry`
      );
      process.exit(1);
    }

    if (status === 403) {
      logger.errorWithHint(
        `Stop channel failed - forbidden (HTTP 403)`,
        `Permission denied. Check calendar access. Webhook record kept for retry`
      );
      process.exit(1);
    }

    if (status === 429) {
      logger.errorWithHint(
        `Stop channel failed - rate limited (HTTP 429)`,
        `Rate limited. Retry after backoff. Webhook record kept for retry`
      );
      process.exit(1);
    }

    if (status && status >= 500 && status < 600) {
      logger.errorWithHint(
        `Stop channel failed - server error (HTTP ${status})`,
        `Google API error. Retry later. Webhook record kept for retry`
      );
      process.exit(1);
    }

    // Unknown error - keep record for retry
    logger.error(
      `Stop channel failed: ${err.message}. Webhook record kept for retry.`
    );
    process.exit(1);
  }

  logger.debug('Stop command completed successfully');
};
