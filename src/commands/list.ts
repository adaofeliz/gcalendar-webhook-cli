/**
 * List command for gcalendar-webhook-cli MVP
 * Lists all webhooks from state files with their status
 */

import { listAccountLabels, readAccountState } from '../lib/state.js';
import { computeWebhookStatus } from '../types/index.js';
import type { WebhookRecord } from '../types/index.js';
import * as logger from '../lib/logger.js';

export interface ListOptions {
  config?: string;
  verbose?: boolean;
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

export const listCommand = (options: ListOptions): void => {
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
};
