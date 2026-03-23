import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GaxiosError } from "gaxios";

vi.mock("../lib/google-auth.js", () => ({
  getAuthorizedClient: vi.fn(),
}));

vi.mock("../lib/calendar.js", () => ({
  watchCalendarEvents: vi.fn(),
}));

vi.mock("../lib/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("googleapis", () => ({
  google: {
    calendar: vi.fn(),
  },
}));

import type { Config, WebhookRecord } from "../types/index.js";
import { refreshWebhook } from "../commands/refresh.js";
import { readAccountState, writeAccountState } from "../lib/state.js";
import { getAuthorizedClient } from "../lib/google-auth.js";
import { watchCalendarEvents } from "../lib/calendar.js";
import { google } from "googleapis";

describe("refresh transactional state updates", () => {
  let tempDir: string;
  let originalBaseDir: string | undefined;
  let mockChannelsStop: ReturnType<typeof vi.fn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  const accountLabel = "acct-1";
  const calendarId = "cal-1";

  const mockConfig: Config = {
    credentials_path: "/fake/credentials.json",
    accounts: [
      {
        label: accountLabel,
        calendars: [{ calendar_id: calendarId, webhook_url: "https://example.com/webhook" }],
      },
    ],
  };

  const makeWebhookRecord = (channelId: string, calId = calendarId): WebhookRecord => ({
    channel_id: channelId,
    resource_id: `res-${channelId}`,
    calendar_id: calId,
    account_label: accountLabel,
    webhook_url: "https://example.com/webhook",
    expiration: Date.now() + 7 * 24 * 60 * 60 * 1000,
    created_at: Date.now(),
  });

  beforeEach(() => {
    originalBaseDir = process.env.GCALENDAR_WEBHOOK_BASE_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gcal-refresh-test-"));
    process.env.GCALENDAR_WEBHOOK_BASE_DIR = tempDir;

    processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    vi.mocked(getAuthorizedClient).mockResolvedValue({} as any);
    vi.mocked(watchCalendarEvents).mockResolvedValue({
      channelId: "new-channel-id",
      resourceId: "new-resource-id",
      expiration: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    mockChannelsStop = vi.fn().mockResolvedValue({});
    vi.mocked(google.calendar).mockReturnValue({
      channels: { stop: mockChannelsStop },
    } as any);

    writeAccountState(accountLabel, {
      account_label: accountLabel,
      webhooks: [makeWebhookRecord("old-channel-id")],
    });
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    if (originalBaseDir === undefined) {
      delete process.env.GCALENDAR_WEBHOOK_BASE_DIR;
    } else {
      process.env.GCALENDAR_WEBHOOK_BASE_DIR = originalBaseDir;
    }

    processExitSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("replaces old record with new record and stops old channel", async () => {
    const oldWebhook = readAccountState(accountLabel).webhooks[0]!;

    const result = await refreshWebhook(accountLabel, oldWebhook, mockConfig);

    expect(result).toBe(true);
    const state = readAccountState(accountLabel);
    expect(state.webhooks).toHaveLength(1);
    expect(state.webhooks[0]?.channel_id).toBe("new-channel-id");
    expect(state.webhooks[0]?.resource_id).toBe("new-resource-id");
    expect(mockChannelsStop).toHaveBeenCalledTimes(1);
    expect(mockChannelsStop).toHaveBeenCalledWith({
      requestBody: {
        id: oldWebhook.channel_id,
        resourceId: oldWebhook.resource_id,
      },
    });
  });

  it("preserves old state when new watch creation fails", async () => {
    const oldWebhook = readAccountState(accountLabel).webhooks[0]!;
    vi.mocked(watchCalendarEvents).mockRejectedValueOnce(new Error("watch failed"));

    const result = await refreshWebhook(accountLabel, oldWebhook, mockConfig);

    expect(result).toBe(false);
    const state = readAccountState(accountLabel);
    expect(state.webhooks).toHaveLength(1);
    expect(state.webhooks[0]?.channel_id).toBe(oldWebhook.channel_id);
    expect(mockChannelsStop).not.toHaveBeenCalled();
  });

  it("preserves old state when auth acquisition fails", async () => {
    const oldWebhook = readAccountState(accountLabel).webhooks[0]!;
    vi.mocked(getAuthorizedClient).mockRejectedValueOnce(new Error("auth failed"));

    const result = await refreshWebhook(accountLabel, oldWebhook, mockConfig);

    expect(result).toBe(false);
    const state = readAccountState(accountLabel);
    expect(state.webhooks).toHaveLength(1);
    expect(state.webhooks[0]?.channel_id).toBe(oldWebhook.channel_id);
    expect(vi.mocked(watchCalendarEvents)).not.toHaveBeenCalled();
    expect(mockChannelsStop).not.toHaveBeenCalled();
  });

  it("preserves old state when calendar config lookup fails", async () => {
    const oldWebhook = readAccountState(accountLabel).webhooks[0]!;
    const missingCalendarConfig: Config = {
      credentials_path: "/fake/credentials.json",
      accounts: [
        {
          label: accountLabel,
          calendars: [{ calendar_id: "different-calendar", webhook_url: "https://example.com/other" }],
        },
      ],
    };

    const result = await refreshWebhook(accountLabel, oldWebhook, missingCalendarConfig);

    expect(result).toBe(false);
    const state = readAccountState(accountLabel);
    expect(state.webhooks).toHaveLength(1);
    expect(state.webhooks[0]?.channel_id).toBe(oldWebhook.channel_id);
    expect(vi.mocked(getAuthorizedClient)).not.toHaveBeenCalled();
    expect(vi.mocked(watchCalendarEvents)).not.toHaveBeenCalled();
    expect(mockChannelsStop).not.toHaveBeenCalled();
  });

  it("succeeds when stopping old channel fails with 404", async () => {
    const oldWebhook = readAccountState(accountLabel).webhooks[0]!;
    mockChannelsStop.mockRejectedValueOnce(
      new GaxiosError("Not Found", {}, { status: 404 } as any)
    );

    const result = await refreshWebhook(accountLabel, oldWebhook, mockConfig);

    expect(result).toBe(true);
    const state = readAccountState(accountLabel);
    expect(state.webhooks).toHaveLength(1);
    expect(state.webhooks[0]?.channel_id).toBe("new-channel-id");
  });

  it("succeeds when stopping old channel fails with 500", async () => {
    const oldWebhook = readAccountState(accountLabel).webhooks[0]!;
    mockChannelsStop.mockRejectedValueOnce(
      new GaxiosError("Server Error", {}, { status: 500 } as any)
    );

    const result = await refreshWebhook(accountLabel, oldWebhook, mockConfig);

    expect(result).toBe(true);
    const state = readAccountState(accountLabel);
    expect(state.webhooks).toHaveLength(1);
    expect(state.webhooks[0]?.channel_id).toBe("new-channel-id");
  });

  it("collapses pre-existing duplicates for same calendar into one new record", async () => {
    const oldWebhook = makeWebhookRecord("old-channel-1", calendarId);
    const duplicateWebhook = makeWebhookRecord("old-channel-2", calendarId);
    const differentCalendarWebhook = makeWebhookRecord("other-channel", "cal-2");

    writeAccountState(accountLabel, {
      account_label: accountLabel,
      webhooks: [oldWebhook, duplicateWebhook, differentCalendarWebhook],
    });

    const result = await refreshWebhook(accountLabel, oldWebhook, mockConfig);

    expect(result).toBe(true);
    const state = readAccountState(accountLabel);
    const refreshedCalendarHooks = state.webhooks.filter((w) => w.calendar_id === calendarId);
    expect(refreshedCalendarHooks).toHaveLength(1);
    expect(refreshedCalendarHooks[0]?.channel_id).toBe("new-channel-id");
    expect(state.webhooks.find((w) => w.calendar_id === "cal-2")?.channel_id).toBe("other-channel");
  });
});
