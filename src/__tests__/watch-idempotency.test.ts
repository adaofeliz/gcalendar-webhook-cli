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

import { watchCommand } from "../commands/watch.js";
import { readAccountState, writeAccountState } from "../lib/state.js";
import { getAuthorizedClient } from "../lib/google-auth.js";
import { watchCalendarEvents } from "../lib/calendar.js";
import { loadConfig } from "../lib/config.js";
import { google } from "googleapis";

describe("watch idempotency", () => {
  let tempDir: string;
  let originalBaseDir: string | undefined;
  let mockChannelsStop: ReturnType<typeof vi.fn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  const mockConfig = {
    credentials_path: "/fake/credentials.json",
    accounts: [
      {
        label: "acct-1",
        calendars: [{ calendar_id: "cal-1", webhook_url: "https://example.com/webhook" }],
      },
    ],
  };

  const makeWebhookRecord = (channelId: string) => ({
    channel_id: channelId,
    resource_id: `res-${channelId}`,
    calendar_id: "cal-1",
    account_label: "acct-1",
    webhook_url: "https://example.com/webhook",
    expiration: Date.now() + 7 * 24 * 60 * 60 * 1000,
    created_at: Date.now(),
  });

  beforeEach(() => {
    originalBaseDir = process.env.GCALENDAR_WEBHOOK_BASE_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gcal-watch-test-"));
    process.env.GCALENDAR_WEBHOOK_BASE_DIR = tempDir;

    processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
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

  it("creates exactly one record when none exists", async () => {
    await watchCommand({ account: "acct-1", calendar: "cal-1" });

    const state = readAccountState("acct-1");
    expect(state.webhooks).toHaveLength(1);
    expect(state.webhooks[0]?.channel_id).toBe("new-channel-id");
    expect(mockChannelsStop).not.toHaveBeenCalled();
  });

  it("replaces one existing record with one new record", async () => {
    writeAccountState("acct-1", {
      account_label: "acct-1",
      webhooks: [makeWebhookRecord("old-channel-1")],
    });

    await watchCommand({ account: "acct-1", calendar: "cal-1" });

    const state = readAccountState("acct-1");
    expect(state.webhooks).toHaveLength(1);
    expect(state.webhooks[0]?.channel_id).toBe("new-channel-id");
    expect(mockChannelsStop).toHaveBeenCalledTimes(1);
    expect(mockChannelsStop).toHaveBeenCalledWith({
      requestBody: {
        id: "old-channel-1",
        resourceId: "res-old-channel-1",
      },
    });
  });

  it("collapses multiple stale records for same calendar into one", async () => {
    writeAccountState("acct-1", {
      account_label: "acct-1",
      webhooks: [
        makeWebhookRecord("old-channel-1"),
        makeWebhookRecord("old-channel-2"),
        makeWebhookRecord("old-channel-3"),
      ],
    });

    await watchCommand({ account: "acct-1", calendar: "cal-1" });

    const state = readAccountState("acct-1");
    const currentCalendarWebhooks = state.webhooks.filter((w) => w.calendar_id === "cal-1");

    expect(currentCalendarWebhooks).toHaveLength(1);
    expect(currentCalendarWebhooks[0]?.channel_id).toBe("new-channel-id");
    expect(mockChannelsStop).toHaveBeenCalledTimes(3);
  });

  it("succeeds when stop old channel returns 404", async () => {
    writeAccountState("acct-1", {
      account_label: "acct-1",
      webhooks: [makeWebhookRecord("old-channel-404")],
    });

    mockChannelsStop.mockRejectedValueOnce(
      new GaxiosError("Not Found", {}, { status: 404 } as any)
    );

    await watchCommand({ account: "acct-1", calendar: "cal-1" });

    const state = readAccountState("acct-1");
    expect(state.webhooks).toHaveLength(1);
    expect(state.webhooks[0]?.channel_id).toBe("new-channel-id");
  });

  it("succeeds when stop old channel returns 410", async () => {
    writeAccountState("acct-1", {
      account_label: "acct-1",
      webhooks: [makeWebhookRecord("old-channel-410")],
    });

    mockChannelsStop.mockRejectedValueOnce(new GaxiosError("Gone", {}, { status: 410 } as any));

    await watchCommand({ account: "acct-1", calendar: "cal-1" });

    const state = readAccountState("acct-1");
    expect(state.webhooks).toHaveLength(1);
    expect(state.webhooks[0]?.channel_id).toBe("new-channel-id");
  });

  it("succeeds when stop old channel throws non-HTTP error", async () => {
    writeAccountState("acct-1", {
      account_label: "acct-1",
      webhooks: [makeWebhookRecord("old-channel-network")],
    });

    mockChannelsStop.mockRejectedValueOnce(new Error("network down"));

    await watchCommand({ account: "acct-1", calendar: "cal-1" });

    const state = readAccountState("acct-1");
    expect(state.webhooks).toHaveLength(1);
    expect(state.webhooks[0]?.channel_id).toBe("new-channel-id");
  });
});
