#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import packageJson from '../package.json';
import { loginCommand } from './commands/login';
import { watchCommand } from './commands/watch';
import { listChannelsCommand } from './commands/channels/list';
import { stopChannelCommand } from './commands/channels/stop';
import { pruneChannelsCommand } from './commands/channels/prune';

const program = new Command();

program
  .name('gcalendar-webhook-cli')
  .description('CLI to manage Google Calendar webhook channels')
  .version(packageJson.version ?? '0.0.0');

program
  .command('login')
  .description('Authorize the CLI with your Google account')
  .action(loginCommand);

program
  .command('watch')
  .description('Create a watch channel for a calendar resource')
  .option('-c, --calendar-id <calendarId>', 'Calendar identifier (defaults to primary calendar)', 'primary')
  .requiredOption('-a, --address <url>', 'HTTPS endpoint that will receive webhook notifications')
  .option('-t, --token <token>', 'Optional channel token (<= 256 characters)')
  .option('--ttl-hours <hours>', 'Requested lifetime in hours for the channel', parseFloat)
  .option('--resource <type>', 'Resource type to watch (events, acl, calendarList, settings)', 'events')
  .action(watchCommand);

const channels = program
  .command('channels')
  .description('Manage cached webhook channels');

channels
  .command('list')
  .description('List known channels and their expiration status')
  .action(listChannelsCommand);

channels
  .command('stop')
  .description('Stop a channel by ID')
  .argument('<channelId>', 'Channel identifier returned by watch command')
  .action(stopChannelCommand);

channels
  .command('prune')
  .description('Stop and remove expired channels')
  .option('--dry-run', 'Only report channels that would be removed')
  .action(pruneChannelsCommand);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
