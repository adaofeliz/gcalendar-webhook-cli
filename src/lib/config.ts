/**
 * Configuration loader for gcalendar-webhook-cli MVP
 * Loads and validates YAML config file
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Config } from '../types/index.js';

export const DEFAULT_CONFIG_PATH = './gcalendar-webhooks.yaml';

export interface LoadConfigOptions {
  path?: string;
}

/**
 * Load and validate configuration from YAML file
 * @param options - Optional configuration options
 * @returns Validated Config object
 * @throws Error with actionable message if validation fails
 */
export function loadConfig(options?: LoadConfigOptions): Config {
  const configPath = options?.path ?? DEFAULT_CONFIG_PATH;
  const absolutePath = path.resolve(configPath);

  // Check if config file exists
  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `Configuration file not found: ${absolutePath}\n` +
      `Please create a config file at this location or specify a different path with --config`
    );
  }

  // Read and parse YAML
  let rawConfig: unknown;
  try {
    const fileContents = fs.readFileSync(absolutePath, 'utf8');
    rawConfig = yaml.load(fileContents);
  } catch (error) {
    throw new Error(
      `Failed to parse YAML configuration file: ${absolutePath}\n` +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Validate structure
  if (!rawConfig || typeof rawConfig !== 'object') {
    throw new Error(
      `Invalid configuration: expected an object, got ${typeof rawConfig}`
    );
  }

  const config = rawConfig as Record<string, unknown>;

  // Validate credentials_path
  if (!config.credentials_path || typeof config.credentials_path !== 'string') {
    throw new Error(
      `Configuration error: 'credentials_path' is required and must be a string`
    );
  }

  const credentialsPath = path.resolve(
    path.dirname(absolutePath),
    config.credentials_path
  );

  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      `Configuration error: credentials file not found at '${credentialsPath}'\n` +
      `Specified in config as: ${config.credentials_path}`
    );
  }

  // Validate accounts array
  if (!Array.isArray(config.accounts)) {
    throw new Error(
      `Configuration error: 'accounts' must be an array`
    );
  }

  if (config.accounts.length === 0) {
    throw new Error(
      `Configuration error: 'accounts' array cannot be empty`
    );
  }

  // Track unique labels
  const seenLabels = new Set<string>();

  // Validate each account
  for (let i = 0; i < config.accounts.length; i++) {
    const account = config.accounts[i];

    if (!account || typeof account !== 'object') {
      throw new Error(
        `Configuration error: accounts[${i}] must be an object`
      );
    }

    const acc = account as Record<string, unknown>;

    // Validate label
    if (!acc.label || typeof acc.label !== 'string') {
      throw new Error(
        `Configuration error: accounts[${i}].label is required and must be a string`
      );
    }

    if (seenLabels.has(acc.label)) {
      throw new Error(
        `Configuration error: duplicate account label '${acc.label}' at accounts[${i}]`
      );
    }
    seenLabels.add(acc.label);

    // Validate calendars array
    if (!Array.isArray(acc.calendars)) {
      throw new Error(
        `Configuration error: accounts[${i}].calendars must be an array (account: '${acc.label}')`
      );
    }

    if (acc.calendars.length === 0) {
      throw new Error(
        `Configuration error: accounts[${i}].calendars cannot be empty (account: '${acc.label}')`
      );
    }

    // Validate each calendar entry
    for (let j = 0; j < acc.calendars.length; j++) {
      const calendar = acc.calendars[j];

      if (!calendar || typeof calendar !== 'object') {
        throw new Error(
          `Configuration error: accounts[${i}].calendars[${j}] must be an object (account: '${acc.label}')`
        );
      }

      const cal = calendar as Record<string, unknown>;

      // Validate calendar_id
      if (!cal.calendar_id || typeof cal.calendar_id !== 'string') {
        throw new Error(
          `Configuration error: accounts[${i}].calendars[${j}].calendar_id is required and must be a string (account: '${acc.label}')`
        );
      }

      // Validate webhook_url
      if (!cal.webhook_url || typeof cal.webhook_url !== 'string') {
        throw new Error(
          `Configuration error: accounts[${i}].calendars[${j}].webhook_url is required and must be a string (account: '${acc.label}')`
        );
      }

      // Validate HTTPS
      if (!cal.webhook_url.startsWith('https://')) {
        throw new Error(
          `Configuration error: accounts[${i}].calendars[${j}].webhook_url must use HTTPS (account: '${acc.label}', calendar: '${cal.calendar_id}')\n` +
          `Got: ${cal.webhook_url}`
        );
      }
    }
  }

  // Return validated config with normalized credentials_path
  return {
    credentials_path: credentialsPath,
    accounts: config.accounts as Config['accounts']
  };
}
