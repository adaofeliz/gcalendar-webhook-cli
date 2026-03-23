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

import { listCommand } from "../commands/list.js";
import { readAccountState, writeAccountState } from "../lib/state.js";
import { getAuthorizedClient } from "../lib/google-auth.js";
import { watchCalendarEvents } from "../lib/calendar.js";
import { loadConfig } from "../lib/config.js";
import { google } from "googleapis";

describe("list --verify rotation behavior", () => {
  let tempDir: string;
  let originalBaseDir: string | undefined;
  let mockChannelsStop: ReturnType<typeof vi.fn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  const accountLabel = "acct-1";
  const calendarId = "cal-1";
  const webhookUrl = "https://example.com/webhook";

  const makeWebhookRecord = (channelId: string, expiration: number) => ({
    channel_id: channelId,
    resource_id: `res-${channelId}`,
    calendar_id: calendarId,
    account_label: accountLabel,
    webhook_url: webhookUrl,
    expiration,
    created_at: Date.now(),
  });

  beforeEach(() => {
    originalBaseDir = process.env.GCALENDAR_WEBHOOK_BASE_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gcal-verify-rotation-test-"));
    process.env.GCALENDAR_WEBHOOK_BASE_DIR = tempDir;

    processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    vi.mocked(loadConfig).mockReturnValue({
      credentials_path: "/fake/credentials.json",
      accounts: [
        {
          label: accountLabel,
          calendars: [{ calendar_id: calendarId, webhook_url: webhookUrl }],
        },
      ],
    } as any);

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

  it("renews an expiring webhook by replacing old state with new channel", async () => {
    writeAccountState(accountLabel, {
      account_label: accountLabel,
      webhooks: [makeWebhookRecord("old-channel-id", Date.now() + 12 * 60 * 60 * 1000)],
    });

    await listCommand({ verify: true, config: "fake" });

    const state = readAccountState(accountLabel);
    expect(state.webhooks).toHaveLength(1);
    expect(state.webhooks[0]?.channel_id).toBe("new-channel-id");
    expect(state.webhooks[0]?.resource_id).toBe("new-resource-id");
    expect(mockChannelsStop).toHaveBeenCalledTimes(1);
    expect(mockChannelsStop).toHaveBeenCalledWith({
      requestBody: {
        id: "old-channel-id",
        resourceId: "res-old-channel-id",
      },
    });
  });

  it("preserves old state when new watch creation fails during verify", async () => {
    const oldWebhook = makeWebhookRecord("old-channel-id", Date.now() + 12 * 60 * 60 * 1000);
    writeAccountState(accountLabel, {
      account_label: accountLabel,
      webhooks: [oldWebhook],
    });
    vi.mocked(watchCalendarEvents).mockRejectedValueOnce(new Error("watch failed"));

    await listCommand({ verify: true, config: "fake" });

    const state = readAccountState(accountLabel);
    expect(state.webhooks).toHaveLength(1);
    expect(state.webhooks[0]).toEqual(oldWebhook);
    expect(mockChannelsStop).not.toHaveBeenCalled();
  });

  it("still renews when stopping old channel returns 404", async () => {
    writeAccountState(accountLabel, {
      account_label: accountLabel,
      webhooks: [makeWebhookRecord("old-channel-404", Date.now() + 12 * 60 * 60 * 1000)],
    });
    mockChannelsStop.mockRejectedValueOnce(
      new GaxiosError("Not Found", {}, { status: 404 } as any)
    );

    await listCommand({ verify: true, config: "fake" });

    const state = readAccountState(accountLabel);
    expect(state.webhooks).toHaveLength(1);
    expect(state.webhooks[0]?.channel_id).toBe("new-channel-id");
    expect(mockChannelsStop).toHaveBeenCalledTimes(1);
  });

  it("cleans expired webhook from state", async () => {
    writeAccountState(accountLabel, {
      account_label: accountLabel,
      webhooks: [makeWebhookRecord("expired-channel-id", Date.now() - 60 * 1000)],
    });

    await listCommand({ verify: true, config: "fake" });

    const state = readAccountState(accountLabel);
    expect(state.webhooks).toHaveLength(0);
    expect(vi.mocked(watchCalendarEvents)).not.toHaveBeenCalled();
    expect(mockChannelsStop).toHaveBeenCalledTimes(1);
  });
});
