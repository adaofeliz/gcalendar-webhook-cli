# gcalendar-webhook-cli

CLI utility for managing Google Calendar webhook (push notification) channels. Configure multiple accounts and calendars via YAML, authenticate via OAuth 2.0, and manage webhook channels with local state tracking.

## Features
- YAML-based configuration for multiple accounts and calendars
- OAuth 2.0 authentication with token persistence
- Create webhook channels for calendar events
- Stop webhook channels
- List all active webhooks (local state only)
- Automatic refresh of expiring/expired webhooks
- Storage under `~/.gcalendar-webhook-cli/`

## Storage Locations

All data is stored under `~/.gcalendar-webhook-cli/`:

```
~/.gcalendar-webhook-cli/
├── tokens/
│   ├── work-account.json     # OAuth tokens for work-account
│   └── personal.json          # OAuth tokens for personal account
└── state/
    ├── work-account.json      # Webhook state for work-account
    └── personal.json          # Webhook state for personal account
```

## Prerequisites
1. **Google Cloud project** with the Google Calendar API enabled.
2. **OAuth 2.0 client credentials** (Desktop application). Download `credentials.json` from your Google Cloud Console.
3. Node.js 18+ (for native fetch and modern syntax).

## Installation
```bash
npm install
npm run build
npm link  # optional, to expose `gcalendar-webhook-cli` globally
```

## Configuration

Create a `gcalendar-webhooks.yaml` file in your project directory. See `examples/gcalendar-webhooks.example.yaml` for a template.

### YAML Schema

```yaml
# Global credentials path (optional, can be overridden per account)
credentials_path: ./credentials.json

accounts:
  - label: work-account                        # Unique account identifier
    credentials_path: ./credentials-work.json  # Optional: override global credentials
    calendars:
      - calendar_id: primary                   # Calendar ID (use 'primary' for main calendar)
        webhook_url: https://example.com/webhooks/work/primary  # HTTPS endpoint
      - calendar_id: team@example.com
        webhook_url: https://example.com/webhooks/work/team

  - label: personal
    calendars:
      - calendar_id: primary
        webhook_url: https://example.com/webhooks/personal/primary
```

### Configuration Fields

- `credentials_path`: Path to OAuth 2.0 credentials JSON file (can be global or per-account)
- `accounts[]`: Array of Google accounts
  - `label`: Unique identifier for the account (used in commands)
  - `credentials_path`: Optional per-account credentials override
  - `calendars[]`: Array of calendars to manage
    - `calendar_id`: Calendar identifier (`primary` or email address)
    - `webhook_url`: HTTPS endpoint that will receive webhook notifications

## Usage

### 1. Authenticate

Authenticate each account configured in your YAML:

```bash
gcalendar-webhook-cli auth --account work-account
gcalendar-webhook-cli auth --account personal
```

The command launches a browser for OAuth consent. After approval, tokens are stored in `~/.gcalendar-webhook-cli/tokens/<account-label>.json`.

### 2. Create Webhook Channels

Create a webhook channel for a specific calendar:

```bash
gcalendar-webhook-cli watch \
  --account work-account \
  --calendar primary
```

This creates a webhook for the calendar specified in your configuration and stores the channel metadata in `~/.gcalendar-webhook-cli/state/<account-label>.json`.

**Options:**
- `-a, --account <label>` (required): Account label from configuration
- `-c, --calendar <calendar-id>` (required): Calendar ID from configuration
- `--config <path>`: Path to configuration file (default: `./gcalendar-webhooks.yaml`)
- `--verbose`: Enable verbose logging

### 3. List Webhook Channels

List all webhook channels from local state:

```bash
gcalendar-webhook-cli list
```

**Important:** The `list` command reflects local state only. It does not query the Google Calendar API. Use it to monitor webhook status and expiration times.

**Options:**
- `--config <path>`: Path to configuration file (default: `./gcalendar-webhooks.yaml`)
- `--verbose`: Enable verbose logging

### 4. Stop Webhook Channels

Stop a webhook channel for a specific calendar:

```bash
gcalendar-webhook-cli stop \
  --account work-account \
  --calendar primary
```

This stops the channel via the Google Calendar API and removes it from local state.

**Options:**
- `-a, --account <label>` (required): Account label from configuration
- `-c, --calendar <calendar-id>` (required): Calendar ID from state
- `--config <path>`: Path to configuration file (default: `./gcalendar-webhooks.yaml`)
- `--verbose`: Enable verbose logging

### 5. Refresh Expiring/Expired Webhooks

Automatically refresh webhooks that are expiring within 3 days or already expired:

```bash
gcalendar-webhook-cli refresh
```

This command:
- Scans all account state files
- Identifies webhooks expiring within 3 days or already expired
- Stops old channels
- Creates new channels with fresh expiration times
- Updates local state

**Cron Example:**

Run refresh daily at 2 AM:

```cron
0 2 * * * cd /path/to/project && /usr/local/bin/gcalendar-webhook-cli refresh --config ./gcalendar-webhooks.yaml
```

**Options:**
- `--config <path>`: Path to configuration file (default: `./gcalendar-webhooks.yaml`)
- `--verbose`: Enable verbose logging

## Webhook Receiver Requirements

Your webhook endpoint must satisfy these requirements:

- **HTTPS with valid publicly trusted certificate** (HTTP is not supported)
- Respond with **2xx status code** to acknowledge receipt
- Expect an initial `sync` notification (message number 1) followed by `exists/not_exists` state changes
- Google sends headers: `X-Goog-Channel-Id`, `X-Goog-Resource-Id`, `X-Goog-Resource-State`
- Delivery does not include event details; use the Calendar API to fetch changes
- Google retries on 5xx errors using exponential backoff

## Channel Expiration and Renewal

Google Calendar webhook channels expire after approximately 7 days. The CLI handles expiration management:

1. **Monitor expiration:** Use `list` command to check webhook status
2. **Automatic refresh:** Use `refresh` command (recommended via cron) to renew expiring channels
3. **Manual renewal:** Use `stop` + `watch` to recreate channels manually

## Development Scripts

- `npm run build` – compile TypeScript to `dist/`
- `npm start` – run the CLI directly via `ts-node`
- `npm run watch` – incremental TypeScript compilation

## Limitations

- OAuth tokens are stored unencrypted on disk. Secure the `~/.gcalendar-webhook-cli/` directory per your environment policies.
- The `list` command reflects local state only and does not query the Google Calendar API.
- Push notifications are not guaranteed; design your webhook receiver to tolerate missed messages.

## License
MIT
