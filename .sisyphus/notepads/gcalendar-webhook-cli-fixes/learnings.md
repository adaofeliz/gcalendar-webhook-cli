
## Task 5: --force flag for refresh command

- Added `force?: boolean` to `RefreshOptions` interface in `src/commands/refresh.ts`
- Modified threshold check at line 243 to use `if (!options.force && timeUntilExpiration > thresholdMs)`
- Added force-specific log message: `Force-refreshing webhook...` when `--force` is set and webhook is not yet expiring
- Added `.option('--force', 'Recreate all webhooks regardless of expiration')` in `src/index.ts`
- TypeScript types pass: `npx tsc --noEmit` exits 0
- Help output confirmed: `node dist/index.js refresh --help` shows `--force` option


## Task 6: --verify flag for list command

- Added `verify?: boolean` to `ListOptions` interface in `src/commands/list.ts`
- Changed `listCommand` from sync `void` to `async Promise<void>` to support API calls
- All API imports gated behind `if (!options.verify) { return; }` — default list path unchanged
- Verify logic three-bucket approach:
  - active >24h: countVerified++, no API call
  - expired <=0: channels.stop() (404/410 ok), remove from state, countCleaned++
  - expiring 0-24h: stop old + watchCalendarEvents new + write state, countRenewed++
- findCalendarConfig helper duplicated locally (not exported from refresh.ts)
- Summary: `Verified: N | Cleaned: N | Renewed: N | Unverified: N`
- --verify added to index.ts list command registration
- tsc --noEmit passes; node dist/index.js list --help shows --verify
- CRITICAL: channels.stop() on active channels DESTROYS them -- only called on expired/expiring-within-24h