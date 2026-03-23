# Operator Notes

This document provides operational guidance for managing the `gcalendar-webhook-cli` tool, including fixed defects, failure modes, and recovery procedures.

## Section 1: Software Defects Fixed (in this release)

| Defect | Resolution |
|--------|------------|
| `watch` was non-idempotent | Now replaces existing webhook record instead of creating duplicates. |
| `refresh` was non-transactional | Now preserves old state until new watch succeeds. |
| `list --verify` was non-transactional | Fixed with same transactional pattern as `refresh`. |
| Auth error messages referenced non-existent `login` command | Now correctly reference `auth` command. |

## Section 2: Non-Code Failure Modes

These are operational failures, NOT software bugs.

| Failure | Type | Symptoms | Recovery |
|---------|------|----------|----------|
| Webhook channel expiration (~7 days) | Operational | No notifications after ~7 days | `gcalendar-webhook-cli refresh --force` |
| Invalid/non-public HTTPS webhook URL | Configuration | `watch` fails with 400/403/404/410 | Verify URL is publicly reachable with valid TLS cert |
| Wrong OAuth client type | Configuration | Auth flow fails or returns wrong token | Re-create OAuth client as "Desktop application" with loopback redirect URI |
| Refresh token revoked | Operational | 401 `invalid_grant` errors | `gcalendar-webhook-cli auth <account>` to re-authenticate |
| Overlap window during rotation | Expected behavior | Brief period with 2 active channels | Not a bug — preferable to notification gaps |
| Remote/local state drift | Residual risk | Orphaned channel on Google's side | Re-run `watch` — old channel expires naturally in ~7 days |

## Section 3: Cronicle Scheduling Recommendation

- Channels expire approximately every 7 days.
- The `refresh` command refreshes channels expiring within 3 days.
- **Recommended schedule**: Run `refresh` every 12 hours to ensure timely renewal.
- Example cron expression: `0 */12 * * *`
- Weekly force-refresh (optional, for full rotation): `0 3 * * 0` (Sunday 3am)
- Monitor exit code: non-zero means at least one refresh failed.
- Log stderr for debugging: `gcalendar-webhook-cli refresh 2>>/var/log/gcalendar-refresh.log`

## Section 4: Manual Recovery Commands

```bash
# List all webhooks (local state only)
gcalendar-webhook-cli list

# Verify channel status and clean expired entries
gcalendar-webhook-cli list --verify

# Force-refresh all webhooks regardless of expiration
gcalendar-webhook-cli refresh --force

# Re-authenticate an account (after token revocation)
gcalendar-webhook-cli auth <account-label>

# Re-create a specific webhook (after state drift)
gcalendar-webhook-cli stop --account <label> --calendar <calendar-id>
gcalendar-webhook-cli watch --account <label> --calendar <calendar-id>
```

## Section 5: Distinguishing Failure Types

- **Software defect**: A bug in the code that produces incorrect behavior (see Section 1 for what was fixed).
- **Operational failure**: Expected failure mode that requires operator action (webhook expiration, token revocation).
- **Configuration error**: Incorrect setup that prevents the tool from working (wrong OAuth type, invalid webhook URL).
- **Expected behavior**: Behavior that looks like a bug but is intentional (overlap window during rotation).
