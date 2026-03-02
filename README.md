# gcalendar-webhook-cli

CLI utility for managing Google Calendar webhook (push notification) channels. Configure multiple accounts and calendars via YAML, authenticate via OAuth 2.0, and manage webhook channels with local state tracking.

## Prerequisites

1. **Google Cloud project** with the Google Calendar API enabled.
2. **OAuth 2.0 client credentials** (Desktop application). Download `credentials.json` from your Google Cloud Console.
3. Node.js 18+ (for native fetch and modern syntax).

## Installation

```bash
git clone git@github.com:adaofeliz/gcalendar-webhook-cli.git
cd gcalendar-webhook-cli
npm install
npm link
```

## Configuration

Create a `gcalendar-webhooks.yaml` file in your project directory:

```yaml
credentials_path: ./credentials.json

accounts:
  - label: my-account
    calendars:
      - calendar_id: primary
        webhook_url: https://your-server.com/webhook/primary
```

**Note:** For local testing, you need a public HTTPS URL. Use a tool like [ngrok](https://ngrok.com/) to expose your local server.

### Configuration Fields

- `credentials_path`: Path to OAuth 2.0 credentials JSON file
- `accounts[]`: Array of Google accounts
  - `label`: Unique identifier for the account (used in commands)
  - `calendars[]`: Array of calendars to manage
    - `calendar_id`: Calendar identifier (`primary` or email address)
    - `webhook_url`: HTTPS endpoint that will receive webhook notifications

## Usage

### 1. Authenticate

```bash
gcalendar-webhook-cli auth --account my-account
```

This opens a browser for OAuth consent. Tokens are stored in `~/.gcalendar-webhook-cli/tokens/`.

### 2. Start Watching

```bash
gcalendar-webhook-cli watch --account my-account --calendar primary
```

Creates a webhook channel for the calendar. State is stored in `~/.gcalendar-webhook-cli/state/`.

### 3. List Active Webhooks

```bash
gcalendar-webhook-cli list
```

Shows all active webhooks from local state, including expiration times.

### 4. Stop Watching

```bash
gcalendar-webhook-cli stop --account my-account --calendar primary
```

Stops the webhook channel via the Google Calendar API and removes it from local state.

### 5. Refresh Expiring Webhooks

```bash
gcalendar-webhook-cli refresh
```

Refreshes webhooks that are expiring within 3 days or already expired.

## Storage Locations

All data is stored under `~/.gcalendar-webhook-cli/`:

```
~/.gcalendar-webhook-cli/
├── tokens/
│   └── my-account.json      # OAuth tokens
└── state/
    └── my-account.json      # Webhook state
```

## Webhook Receiver Requirements

Your webhook endpoint must meet these requirements:

- **HTTPS with valid publicly trusted certificate** (HTTP is not supported)
- Respond with **2xx status code** to acknowledge receipt
- Expect an initial `sync` notification followed by `exists/not_exists` state changes
- Google sends headers: `X-Goog-Channel-Id`, `X-Goog-Resource-Id`, `X-Goog-Resource-State`
- Delivery does not include event details; use the Calendar API to fetch changes
- Google retries on 5xx errors using exponential backoff

## Channel Expiration and Renewal

Google Calendar webhook channels expire after approximately 7 days. Manage expiration with:

1. **Monitor:** Use `list` to check webhook status
2. **Refresh:** Run `gcalendar-webhook-cli refresh` to renew expiring channels
3. **Manual:** Use `stop` then `watch` to recreate channels

## Limitations

- OAuth tokens are stored unencrypted on disk. Secure the `~/.gcalendar-webhook-cli/` directory.
- The `list` command reflects local state only and does not query the Google Calendar API.
- Push notifications are not guaranteed; design your webhook receiver to tolerate missed messages.

## Development Scripts

- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run the CLI directly via `ts-node`
- `npm run watch` — incremental TypeScript compilation

## License

MIT
