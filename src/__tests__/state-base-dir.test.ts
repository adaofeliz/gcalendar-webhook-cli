import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  listAccountLabels,
  readAccountState,
  writeAccountState,
  writeAccountTokens,
} from "../lib/state.js";

describe("state base dir", () => {
  let tempDir: string;
  let originalBaseDir: string | undefined;

  beforeEach(() => {
    originalBaseDir = process.env.GCALENDAR_WEBHOOK_BASE_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gcalendar-base-dir-"));
    process.env.GCALENDAR_WEBHOOK_BASE_DIR = tempDir;
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
  });

  it("writeAccountState creates file under custom base dir", () => {
    writeAccountState("alpha", { account_label: "alpha", webhooks: [] });

    expect(fs.existsSync(path.join(tempDir, "state", "alpha.json"))).toBe(true);
  });

  it("writeAccountTokens creates file under custom base dir", () => {
    writeAccountTokens("beta", { access_token: "token" });

    expect(fs.existsSync(path.join(tempDir, "accounts", "beta.json"))).toBe(true);
  });

  it("readAccountState returns empty state when file is missing", () => {
    expect(readAccountState("gamma")).toEqual({ account_label: "gamma", webhooks: [] });
  });

  it("does not touch the default home storage path when overridden", () => {
    const defaultStateDir = path.join(os.homedir(), ".gcalendar-webhook-cli", "state");

    writeAccountState("delta", { account_label: "delta", webhooks: [] });

    expect(fs.existsSync(path.join(defaultStateDir, "delta.json"))).toBe(false);
    expect(listAccountLabels()).toEqual(["delta"]);
  });
});
