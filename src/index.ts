#!/usr/bin/env node

import { Command } from 'commander';
import packageJson from '../package.json';
import { registerAuthCommand } from './commands/auth.js';
import { watchCommand } from './commands/watch.js';
import { stopCommand } from './commands/stop.js';
import { listCommand } from './commands/list.js';
import { refreshCommand } from './commands/refresh.js';

const program = new Command();

program
  .name('gcalendar-webhook-cli')
  .description('CLI to manage Google Calendar webhook channels')
  .version(packageJson.version ?? '0.0.0');

// Register auth command (OAuth flow)
registerAuthCommand(program);

// Watch command - create a webhook channel for a calendar
program
  .command('watch')
  .description('Create a webhook channel for a calendar')
  .requiredOption('-a, --account <label>', 'Account label from configuration')
  .requiredOption('-c, --calendar <calendar-id>', 'Calendar ID from configuration')
  .option('--config <path>', 'Path to configuration file (default: ./gcalendar-webhooks.yaml)')
  .option('--verbose', 'Enable verbose logging')
  .action(watchCommand);

// Stop command - stop a webhook channel for a calendar
program
  .command('stop')
  .description('Stop a webhook channel for a calendar')
  .requiredOption('-a, --account <label>', 'Account label from configuration')
  .requiredOption('-c, --calendar <calendar-id>', 'Calendar ID from state')
  .option('--config <path>', 'Path to configuration file (default: ./gcalendar-webhooks.yaml)')
  .option('--verbose', 'Enable verbose logging')
  .action(stopCommand);

// List command - list all webhook channels from state
program
  .command('list')
  .description('List all webhook channels (reflects local state only)')
  .option('--config <path>', 'Path to configuration file (default: ./gcalendar-webhooks.yaml)')
  .option('--verbose', 'Enable verbose logging')
  .action(listCommand);

// Refresh command - refresh expiring/expired webhooks
program
  .command('refresh')
  .description('Refresh expiring/expired webhooks for all configured calendars')
  .option('--config <path>', 'Path to configuration file (default: ./gcalendar-webhooks.yaml)')
  .option('--verbose', 'Enable verbose logging')
  .action(refreshCommand);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
