/**
 * Auth command for gcalendar-webhook-cli MVP
 * Runs OAuth flow for a specified account label
 */

import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { authFlow } from '../lib/google-auth.js';
import * as logger from '../lib/logger.js';

interface AuthOptions {
  config?: string;
  verbose?: boolean;
}

/**
 * Auth command implementation
 * @param accountLabel - Account label to authenticate
 * @param options - CLI options (config path, verbose)
 */
export const authCommand = async (
  accountLabel: string,
  options: AuthOptions
): Promise<void> => {
  // Set verbose mode if requested
  if (options.verbose) {
    logger.setVerbose(true);
  }

  logger.debug(`Loading config from: ${options.config ?? 'default path'}`);

  // Load and validate configuration
  let config;
  try {
    config = loadConfig({ path: options.config });
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(1);
  }

  // Validate that account label exists in config
  const account = config.accounts.find((acc) => acc.label === accountLabel);
  if (!account) {
    const availableLabels = config.accounts.map((acc) => acc.label).join(', ');
    logger.errorWithHint(
      `Account label "${accountLabel}" not found in configuration`,
      `Available accounts: ${availableLabels}`
    );
    process.exit(1);
  }

  logger.debug(`Found account "${accountLabel}" with ${account.calendars.length} calendar(s)`);

  // Run OAuth flow
  try {
    await authFlow(accountLabel, config);
  } catch (error) {
    logger.error(`Authentication failed: ${(error as Error).message}`);
    if (options.verbose && error instanceof Error) {
      logger.debug(logger.getStackTrace(error));
    }
    process.exit(1);
  }
};

/**
 * Register auth command with commander
 */
export const registerAuthCommand = (program: Command): void => {
  program
    .command('auth <account-label>')
    .description('Authenticate with Google Calendar for a specific account')
    .option('--config <path>', 'Path to configuration file')
    .option('--verbose', 'Enable verbose logging')
    .action(authCommand);
};
