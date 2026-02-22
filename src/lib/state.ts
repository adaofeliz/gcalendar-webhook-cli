/**
 * Per-account token and webhook state storage for gcalendar-webhook-cli MVP
 * Base directory: ~/.gcalendar-webhook-cli/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { OAuthToken, WebhookStateFile } from '../types/index.js';

const BASE_DIR = path.join(os.homedir(), '.gcalendar-webhook-cli');
const ACCOUNTS_DIR = path.join(BASE_DIR, 'accounts');
const STATE_DIR = path.join(BASE_DIR, 'state');

const LABEL_REGEX = /^[A-Za-z0-9_-]+$/;

/**
 * Validate account label to prevent path traversal
 * @throws Error if label contains invalid characters
 */
const validateLabel = (label: string): void => {
  if (!LABEL_REGEX.test(label)) {
    throw new Error(
      `Invalid account label "${label}". Only alphanumeric characters, underscores, and hyphens are allowed.`
    );
  }
};

/**
 * Ensure directory exists with secure permissions (0o700)
 */
const ensureDir = (dirPath: string): void => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
};

/**
 * Atomic JSON write with secure file permissions (0o600)
 */
const writeJsonAtomically = (filePath: string, data: unknown): void => {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  fs.renameSync(tmpPath, filePath);
};

/**
 * Read JSON file with fallback for missing files
 */
const readJsonFile = <T>(filePath: string, fallback: T): T => {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
};

/**
 * Read OAuth tokens for an account
 * @returns OAuthToken or null if file does not exist
 */
export const readAccountTokens = (label: string): OAuthToken | null => {
  validateLabel(label);
  const filePath = path.join(ACCOUNTS_DIR, `${label}.json`);
  
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as OAuthToken;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

/**
 * Write OAuth tokens for an account (merges with existing)
 */
export const writeAccountTokens = (
  label: string,
  tokens: Partial<OAuthToken>
): void => {
  validateLabel(label);
  const filePath = path.join(ACCOUNTS_DIR, `${label}.json`);
  
  const existing = readAccountTokens(label);
  const merged = existing ? { ...existing, ...tokens } : tokens;

  writeJsonAtomically(filePath, merged);
};

/**
 * Read webhook state for an account
 * @returns WebhookStateFile with empty webhooks array if file does not exist
 */
export const readAccountState = (label: string): WebhookStateFile => {
  validateLabel(label);
  const filePath = path.join(STATE_DIR, `${label}.json`);
  
  return readJsonFile<WebhookStateFile>(filePath, {
    account_label: label,
    webhooks: [],
  });
};

/**
 * Write webhook state for an account
 */
export const writeAccountState = (
  label: string,
  state: WebhookStateFile
): void => {
  validateLabel(label);
  const filePath = path.join(STATE_DIR, `${label}.json`);
  
  writeJsonAtomically(filePath, state);
};

/**
 * List all account labels from state files
 * @returns Array of account labels (without .json extension)
 */
export const listAccountLabels = (): string[] => {
  ensureDir(STATE_DIR);
  
  try {
    const files = fs.readdirSync(STATE_DIR);
    return files
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -5));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};
