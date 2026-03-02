/**
 * List command for gcalendar-webhook-cli MVP
 * Lists all webhooks from state files with their status
 */

import { listAccountLabels, readAccountState, writeAccountState } from '../lib/state.js';
import { computeWebhookStatus } from '../types/index.js';
import type { WebhookRecord, Config, CalendarEntry } from '../types/index.js';
import { loadConfig } from '../lib/config.js';
import { getAuthorizedClient } from '../lib/google-auth.js';
import { watchCalendarEvents } from '../lib/calendar.js';
import { google } from 'googleapis';
import { GaxiosError } from 'gaxios';
import * as logger from '../lib/logger.js';

export interface ListOptions {
  config?: string;
  verbose?: boolean;
  verify?: boolean;
}

interface WebhookRow {
  account: string;
  calendar_id: string;
  status: string;
  expiration: string;
  webhook_url: string;
}

const formatTable = (rows: WebhookRow[]): string => {
  if (rows.length === 0) {
    return '';
  }

  const headers = {
    account: 'Account',
    calendar_id: 'Calendar ID',
    status: 'Status',
    expiration: 'Expiration (ISO)',
    webhook_url: 'Webhook URL',
  };

  const widths = {
    account: Math.max(headers.account.length, ...rows.map((r) => r.account.length)),
    calendar_id: Math.max(headers.calendar_id.length, ...rows.map((r) => r.calendar_id.length)),
    status: Math.max(headers.status.length, ...rows.map((r) => r.status.length)),
    expiration: Math.max(headers.expiration.length, ...rows.map((r) => r.expiration.length)),
    webhook_url: Math.max(headers.webhook_url.length, ...rows.map((r) => r.webhook_url.length)),
  };

  const headerRow = [
    headers.account.padEnd(widths.account),
    headers.calendar_id.padEnd(widths.calendar_id),
    headers.status.padEnd(widths.status),
    headers.expiration.padEnd(widths.expiration),
    headers.webhook_url.padEnd(widths.webhook_url),
  ].join(' | ');

  const separator = [
    '-'.repeat(widths.account),
    '-'.repeat(widths.calendar_id),
    '-'.repeat(widths.status),
    '-'.repeat(widths.expiration),
    '-'.repeat(widths.webhook_url),
  ].join('-|-');

  const dataRows = rows.map((row) =>
    [
      row.account.padEnd(widths.account),
      row.calendar_id.padEnd(widths.calendar_id),
      row.status.padEnd(widths.status),
      row.expiration.padEnd(widths.expiration),
      row.webhook_url.padEnd(widths.webhook_url),
    ].join(' | ')
  );

  return [headerRow, separator, ...dataRows].join('\n');
};


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

export const listCommand = async (options: ListOptions): Promise<void> => {
  if (options.verbose) {
    logger.setVerbose(true);
  }

  logger.debug('List command started');

  const accountLabels = listAccountLabels();
  logger.debug(`Found ${accountLabels.length} account(s)`);

  const allWebhooks: Array<{ webhook: WebhookRecord; account: string }> = [];

  for (const label of accountLabels) {
    logger.debug(`Reading state for account: ${label}`);
    const state = readAccountState(label);
    logger.debug(`Found ${state.webhooks.length} webhook(s) for account: ${label}`);

    for (const webhook of state.webhooks) {
      allWebhooks.push({ webhook, account: label });
    }
  }

  if (allWebhooks.length === 0) {
    logger.log('No webhooks found.');
    process.exit(0);
  }

  logger.debug(`Total webhooks: ${allWebhooks.length}`);

  allWebhooks.sort((a, b) => {
    const accountCompare = a.account.localeCompare(b.account);
    if (accountCompare !== 0) {
      return accountCompare;
    }
    return a.webhook.calendar_id.localeCompare(b.webhook.calendar_id);
  });

  const rows: WebhookRow[] = allWebhooks.map(({ webhook, account }) => {
    const status = computeWebhookStatus(webhook.expiration);
    const expiration = new Date(webhook.expiration).toISOString();

    return {
      account,
      calendar_id: webhook.calendar_id,
      status,
      expiration,
      webhook_url: webhook.webhook_url,
    };
  });

  const table = formatTable(rows);
  logger.log(table);

  logger.debug('List command completed successfully');

  if (!options.verify) {
    return;
  }

  // --verify mode: probe expired/expiring channels via Google API
  logger.log('');
  logger.log('=== Verifying channel status via Google API ===');

  let config: Config;
  try {
    config = loadConfig({ path: options.config });
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(1);
  }

  const oneDayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();

  let countVerified = 0;   // active > 24h, no API call
  let countCleaned = 0;    // expired, confirmed dead and removed
  let countRenewed = 0;    // expiring within 24h, renewed
  let countErrors = 0;

  for (const { webhook, account } of allWebhooks) {
    const timeUntilExpiration = webhook.expiration - now;

    if (timeUntilExpiration > oneDayMs) {
      // Active and > 24h away — no API call needed
      countVerified++;
      logger.debug(`[${account}] [${webhook.calendar_id}]: Active (unverified) — skipping API call`);
      continue;
    }

    if (timeUntilExpiration <= 0) {
      // Already expired — stop to confirm death, then remove from state
      logger.log(`[${account}] [${webhook.calendar_id}]: Expired — cleaning from state...`);
      try {
        const auth = await getAuthorizedClient(account, config);
        const calApi = google.calendar({ version: 'v3', auth });
        try {
          await calApi.channels.stop({
            requestBody: {
              id: webhook.channel_id,
              resourceId: webhook.resource_id,
            },
          });
          logger.debug(`[${account}] [${webhook.calendar_id}]: Channel stop confirmed (was still registered)`);
        } catch (stopErr) {
          const err = stopErr as GaxiosError;
          const status = err.response?.status;
          if (status === 404 || status === 410) {
            logger.debug(`[${account}] [${webhook.calendar_id}]: Channel already dead (HTTP ${status})`);
          } else {
            logger.warn(`[${account}] [${webhook.calendar_id}]: Unexpected stop error: ${err.message}`);
          }
        }
        // Remove from state regardless of stop outcome
        const state = readAccountState(account);
        state.webhooks = state.webhooks.filter(
          (w) => !(w.calendar_id === webhook.calendar_id && w.channel_id === webhook.channel_id)
        );
        writeAccountState(account, state);
        countCleaned++;
        logger.log(`✓ [${account}] [${webhook.calendar_id}]: Expired channel cleaned from state`);
      } catch (error) {
        logger.warn(`[${account}] [${webhook.calendar_id}]: Failed to clean expired channel: ${(error as Error).message}`);
        countErrors++;
      }
      continue;
    }

    // Expiring within 24h — proactively renew to prevent gaps
    logger.log(`[${account}] [${webhook.calendar_id}]: Expiring within 24h — renewing...`);
    try {
      const calendarConfig = findCalendarConfig(config, account, webhook.calendar_id);
      if (!calendarConfig) {
        logger.warn(`[${account}] [${webhook.calendar_id}]: Calendar not found in config, cannot renew`);
        countErrors++;
        continue;
      }

      const auth = await getAuthorizedClient(account, config);
      const calApi = google.calendar({ version: 'v3', auth });

      // Stop old channel gracefully
      try {
        await calApi.channels.stop({
          requestBody: {
            id: webhook.channel_id,
            resourceId: webhook.resource_id,
          },
        });
      } catch (stopErr) {
        const err = stopErr as GaxiosError;
        const status = err.response?.status;
        if (status !== 404 && status !== 410) {
          logger.warn(`[${account}] [${webhook.calendar_id}]: Warning stopping expiring channel: ${err.message}`);
        }
      }

      // Remove old record from state
      const state = readAccountState(account);
      state.webhooks = state.webhooks.filter(
        (w) => !(w.calendar_id === webhook.calendar_id && w.channel_id === webhook.channel_id)
      );
      writeAccountState(account, state);

      // Create new channel
      const watchResponse = await watchCalendarEvents(auth, webhook.calendar_id, calendarConfig.webhook_url);
      const nowMs = Date.now();
      const newWebhook: WebhookRecord = {
        channel_id: watchResponse.channelId,
        resource_id: watchResponse.resourceId,
        calendar_id: webhook.calendar_id,
        account_label: account,
        webhook_url: calendarConfig.webhook_url,
        expiration: watchResponse.expiration ?? nowMs + (7 * 24 * 60 * 60 * 1000),
        created_at: nowMs,
      };

      const updatedState = readAccountState(account);
      updatedState.webhooks.push(newWebhook);
      writeAccountState(account, updatedState);

      countRenewed++;
      logger.log(`✓ [${account}] [${webhook.calendar_id}]: Expiring channel renewed successfully`);
    } catch (error) {
      logger.warn(`[${account}] [${webhook.calendar_id}]: Failed to renew expiring channel: ${(error as Error).message}`);
      countErrors++;
    }
  }

  logger.log('');
  logger.log(`Verified: ${countVerified} | Cleaned: ${countCleaned} | Renewed: ${countRenewed} | Unverified: ${countErrors}`);

};
