/**
 * OAuth 2.0 loopback authentication for gcalendar-webhook-cli MVP
 * Implements authFlow and getAuthorizedClient with token refresh
 */

import http from 'http';
import { URL } from 'url';
import * as fs from 'fs';
import { google } from 'googleapis';
import type { OAuth2Client, Credentials } from 'google-auth-library';
import type { Config } from '../types/index.js';
import * as logger from './logger.js';
import { readAccountTokens, writeAccountTokens } from './state.js';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * Shape of credentials.json from Google Cloud Console
 */
interface CredentialsFile {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

/**
 * Extract OAuth credentials from credentials.json
 * @throws Error if credentials.json is invalid or missing required fields
 */
const loadCredentials = (config: Config): { clientId: string; clientSecret: string; redirectUris: string[] } => {
  const credentialsPath = config.credentials_path;

  let raw: string;
  try {
    raw = fs.readFileSync(credentialsPath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read credentials file at ${credentialsPath}: ${(error as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in credentials file ${credentialsPath}: ${(error as Error).message}`);
  }

  const creds = parsed as CredentialsFile;
  const source = creds.installed || creds.web;

  if (!source) {
    throw new Error(
      `Invalid credentials.json format. Expected "installed" or "web" key in ${credentialsPath}`
    );
  }

  if (!source.client_id || !source.client_secret) {
    throw new Error(
      `Missing client_id or client_secret in credentials.json at ${credentialsPath}`
    );
  }

  if (!Array.isArray(source.redirect_uris) || source.redirect_uris.length === 0) {
    throw new Error(
      `Missing or empty redirect_uris in credentials.json at ${credentialsPath}`
    );
  }

  return {
    clientId: source.client_id,
    clientSecret: source.client_secret,
    redirectUris: source.redirect_uris,
  };
};

/**
 * Select a loopback redirect URI from the list
 * Prefers localhost, then 127.0.0.1
 */
const selectLoopbackUri = (redirectUris: string[]): string => {
  // Try localhost first
  const localhostUri = redirectUris.find(
    (uri) => uri.startsWith('http://localhost:') || uri.startsWith('http://localhost/')
  );
  if (localhostUri) return localhostUri;

  // Try 127.0.0.1
  const loopbackUri = redirectUris.find(
    (uri) => uri.startsWith('http://127.0.0.1:') || uri.startsWith('http://127.0.0.1/')
  );
  if (loopbackUri) return loopbackUri;

  throw new Error(
    `No loopback redirect URI found in credentials.json. Expected http://localhost:* or http://127.0.0.1:*`
  );
};

/**
 * OAuth 2.0 authorization flow - prints URL and runs callback server
 * @param accountLabel - Account label to store tokens under
 * @param config - Configuration with credentials_path
 * @throws Error if auth flow fails
 */
export const authFlow = async (accountLabel: string, config: Config): Promise<void> => {
  const { clientId, clientSecret, redirectUris } = loadCredentials(config);
  const redirectUri = selectLoopbackUri(redirectUris);

  const oauth2Client = new google.auth.OAuth2({
    clientId,
    clientSecret,
    redirectUri,
  });

  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  logger.log(`Visit this URL to authorize:\n${authorizeUrl}`);

  const { hostname, port, pathname } = new URL(redirectUri);
  const callbackPath = pathname || '/callback';

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url) {
          res.writeHead(400);
          res.end('Missing URL');
          return;
        }

        const incomingUrl = new URL(req.url, `http://${hostname}:${port}`);
        if (incomingUrl.pathname !== callbackPath) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        const code = incomingUrl.searchParams.get('code');
        const error = incomingUrl.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Authorization failed. You can close this window.');
          reject(new Error(`Authorization error: ${error}`));
          server.close();
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing authorization code.');
          reject(new Error('Missing authorization code'));
          server.close();
          return;
        }

        const { tokens } = await oauth2Client.getToken(code);
        
        // MERGE semantics - preserve any existing refresh_token
        writeAccountTokens(accountLabel, {
          access_token: tokens.access_token ?? undefined,
          refresh_token: tokens.refresh_token ?? undefined,
          token_type: tokens.token_type ?? 'Bearer',
          expiry_date: tokens.expiry_date ?? undefined,
          scope: tokens.scope ?? SCOPES.join(' '),
        });

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Authorization complete. You can close this window.');

        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });

    const portNum = port ? Number(port) : 80;
    server.listen(portNum, hostname, () => {
      logger.debug(`Listening for OAuth callback on ${hostname}:${portNum}${callbackPath}`);
    });

    server.on('error', (err) => {
      reject(err);
    });
  });

  logger.log('Authentication successful.');
};

/**
 * Get authorized OAuth2Client with fresh access token
 * @param accountLabel - Account label to load tokens for
 * @param config - Configuration with credentials_path
 * @returns OAuth2Client with valid credentials
 * @throws Never - exits process on error
 */
export const getAuthorizedClient = async (accountLabel: string, config: Config): Promise<OAuth2Client> => {
  const tokens = readAccountTokens(accountLabel);

  if (!tokens) {
    logger.error(
      `No stored credentials found for account "${accountLabel}". Run 'auth' command first.`
    );
    process.exit(1);
  }

  if (!tokens.refresh_token) {
    logger.error(
      `Missing refresh_token for account "${accountLabel}". Run 'auth' command to re-authenticate.`
    );
    process.exit(1);
  }

  const { clientId, clientSecret, redirectUris } = loadCredentials(config);
  const redirectUri = selectLoopbackUri(redirectUris);

  const oauth2Client = new google.auth.OAuth2({
    clientId,
    clientSecret,
    redirectUri,
  });

  oauth2Client.setCredentials(tokens as Credentials);

  // Set up token refresh event to persist updates
  oauth2Client.on('tokens', (newTokens: Credentials) => {
    logger.debug('Token refresh triggered, updating stored tokens');
    
    // MERGE semantics - never clobber refresh_token
    const tokenUpdate: Record<string, any> = {
      access_token: newTokens.access_token ?? undefined,
      token_type: newTokens.token_type ?? tokens.token_type,
      expiry_date: newTokens.expiry_date ?? undefined,
      scope: newTokens.scope ?? tokens.scope,
    };
    
    // Only include refresh_token if it's actually present (Google only sends it on initial auth)
    if (newTokens.refresh_token) {
      tokenUpdate.refresh_token = newTokens.refresh_token;
    }
    
    writeAccountTokens(accountLabel, tokenUpdate);
  });

  // Ensure access token is fresh before returning
  try {
    await oauth2Client.getAccessToken();
  } catch (error) {
    const err = error as Error;
    
    // Check for invalid_grant error (expired or revoked refresh_token)
    if (err.message.includes('invalid_grant')) {
      logger.error(
        `Refresh token for account "${accountLabel}" is invalid or expired. Run 'auth' command to re-authenticate.`
      );
      process.exit(1);
    }

    logger.error(
      `Failed to refresh access token for account "${accountLabel}": ${err.message}`
    );
    process.exit(1);
  }

  return oauth2Client;
};
