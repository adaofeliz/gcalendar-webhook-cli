import http from 'http';
import { URL } from 'url';
import { google } from 'googleapis';
import type { Credentials, OAuth2Client } from 'google-auth-library';
import open from 'open';
import { ensureConfigDir, paths, readJsonFile, writeJsonAtomically } from '../config';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

type StoredCredentials = Credentials;

type ClientSecrets = {
  clientId: string;
  clientSecret: string;
  redirectPort: number;
};

const loadClientSecrets = (): ClientSecrets => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectPort = Number(process.env.GOOGLE_REDIRECT_PORT ?? '53682');

  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variables.');
  }

  if (!Number.isInteger(redirectPort) || redirectPort < 1024 || redirectPort > 65535) {
    throw new Error('GOOGLE_REDIRECT_PORT must be an integer between 1024 and 65535');
  }

  return { clientId, clientSecret, redirectPort };
};

const createOAuthClient = (): { client: OAuth2Client; redirectUri: string } => {
  const { clientId, clientSecret, redirectPort } = loadClientSecrets();
  const redirectUri = `http://127.0.0.1:${redirectPort}/oauth2callback`;
  const client = new google.auth.OAuth2({ clientId, clientSecret, redirectUri });
  return { client, redirectUri };
};

const loadStoredTokens = (): StoredCredentials | null => {
  ensureConfigDir();
  return readJsonFile<StoredCredentials | null>(paths.tokensFile, null);
};

const saveTokens = (tokens: StoredCredentials): void => {
  writeJsonAtomically(paths.tokensFile, tokens);
  console.log(`Tokens saved to ${paths.tokensFile}`);
};

export const getAuthorizedClient = async (): Promise<OAuth2Client> => {
  const { client } = createOAuthClient();
  const tokens = loadStoredTokens();

  if (!tokens || (!tokens.refresh_token && !tokens.access_token)) {
    throw new Error('No stored credentials available. Please run `gcalendar-webhook-cli login` first.');
  }

  client.setCredentials(tokens);
  return client;
};

export const login = async (): Promise<void> => {
  ensureConfigDir();
  const { client, redirectUri } = createOAuthClient();

  const authorizeUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  const { hostname, port } = new URL(redirectUri);

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url) {
          res.writeHead(400);
          res.end('Missing URL');
          return;
        }

        const incomingUrl = new URL(req.url, `http://${hostname}:${port}`);
        if (incomingUrl.pathname !== '/oauth2callback') {
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

        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);
        saveTokens({
          access_token: tokens.access_token ?? undefined,
          refresh_token: tokens.refresh_token ?? undefined,
          scope: tokens.scope ?? undefined,
          token_type: tokens.token_type ?? undefined,
          expiry_date: tokens.expiry_date ?? undefined,
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

    server.listen(Number(port), hostname, () => {
      console.log('Listening for OAuth callback...');
      void open(authorizeUrl).catch(() => {
        console.log('Unable to open browser automatically. Visit the following URL:');
        console.log(authorizeUrl);
      });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });

  console.log('Login successful.');
};
