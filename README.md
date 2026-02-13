# gcalendar-webhook-cli

CLI utility for creating and managing Google Calendar webhook (push notification) channels. It wraps the Calendar API watch/stop endpoints, handles OAuth 2.0 installed-app authentication, and stores channel metadata locally for easy management.

## Features
- OAuth 2.0 login flow with token persistence under `~/.config/gcalendar-webhook-cli/`
- `watch` command to create webhook channels for calendar events, ACLs, calendar list, or settings
- Local channel registry with `channels list`, `channels stop`, and `channels prune`
- HTTPS endpoint validation and optional TTL/token support

## Prerequisites
1. **Google Cloud project** with the Google Calendar API enabled.
2. **OAuth 2.0 client credentials** (Desktop application) for your project. Record the client ID and secret.
3. Register the redirect URI `http://127.0.0.1:53682/oauth2callback` (or your custom port) for the OAuth client.
4. Node.js 18+ (for native fetch and modern syntax).

## Installation
```bash
npm install
npm run build
npm link  # optional, to expose `gcalendar-webhook-cli`
```

Copy `.env.example` to `.env` and populate your credentials:

```bash
cp .env.example .env
```

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
# GOOGLE_REDIRECT_PORT=53682
```

Alternatively, export the variables directly in your shell.

## Usage

### 1. Log in
```bash
```
The command launches a browser for consent. After approval, the CLI stores refresh/access tokens in `~/.config/gcalendar-webhook-cli/tokens.json`.

### 2. Create a watch channel
```bash
  --calendar-id user@example.com \
  --address https://yourdomain.com/notifications \
  --ttl-hours 168 \
  --token forwardTo=crm
```

Options:
- `--calendar-id` (default: `primary`) – required for `events`/`acl` resources.
- `--address` – HTTPS endpoint that will receive notifications.
- `--resource` – `events`, `acl`, `calendarList`, or `settings` (default `events`).
- `--ttl-hours` – request an expiration in hours (otherwise Google applies defaults).
- `--token` – optional opaque token echoed back by Google in headers (≤256 chars).

The command prints the channel identifiers and caches them locally for later use.

### 3. Inspect channels
```bash
```

### 4. Stop a channel
```bash
```

### 5. Prune expired channels
```bash
```
Add `--dry-run` to preview without stopping.

## Webhook Receiver Requirements
- Endpoint **must** be HTTPS with a valid publicly trusted certificate.
- Expect an initial `sync` notification (message number 1) followed by `exists/not_exists`.
- Google sends headers such as `X-Goog-Channel-Id`, `X-Goog-Resource-Id`, `X-Goog-Resource-State`.
- Delivery does not include payload details; follow-up API calls are required to fetch changes.
- Respond with 2xx to acknowledge; Google retries on 5xx using exponential backoff.

## Renewing Channels
Channels expire. Use `channels list` to monitor expiration times and issue new `watch` commands before expiry. When recreating, Google requires unique channel IDs; the CLI auto-generates fresh UUIDs.

## Limitations
- The CLI stores tokens unencrypted on disk. Secure the config directory per your environment policies.
- Live API interactions require valid Google credentials and network access; automated tests are not included.
- Push notifications are not guaranteed; always design your webhook receiver to tolerate missed messages.

## Development Scripts
- `npm run build` – compile TypeScript to `dist/`
- `npm start` – run the CLI directly via `ts-node`
- `npm run watch` – incremental TypeScript compilation

## License
MIT
