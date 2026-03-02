import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { writeAccountTokens, readAccountTokens } from "../lib/state.js";

describe("Token Merge", () => {
  let tempDir: string;
  let originalAccountsDir: string;

  beforeEach(() => {
    // Create a temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gcalendar-test-"));
    // Store original env
    originalAccountsDir = process.env.ACCOUNTS_DIR || "";
    // Override the accounts directory for testing
    process.env.ACCOUNTS_DIR = tempDir;
  });

  afterEach(() => {
    // Cleanup temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    // Restore original env
    if (originalAccountsDir) {
      process.env.ACCOUNTS_DIR = originalAccountsDir;
    } else {
      delete process.env.ACCOUNTS_DIR;
    }
  });

  it("should preserve refresh_token when new tokens omit it", () => {
    const label = "test-account";

    // First write with refresh_token
    writeAccountTokens(label, {
      access_token: "original_access",
      refresh_token: "original_refresh",
      token_type: "Bearer",
      expiry_date: Date.now() + 3600000,
      scope: "https://www.googleapis.com/auth/calendar",
    });

    // Second write without refresh_token (simulates Google token refresh)
    writeAccountTokens(label, {
      access_token: "new_access",
      token_type: "Bearer",
      expiry_date: Date.now() + 3600000,
      scope: "https://www.googleapis.com/auth/calendar",
    });

    // Read back and verify refresh_token is preserved
    const tokens = readAccountTokens(label);
    expect(tokens).not.toBeNull();
    expect(tokens?.access_token).toBe("new_access");
    expect(tokens?.refresh_token).toBe("original_refresh"); // Should be preserved!
  });

  it("should update refresh_token when new tokens include it", () => {
    const label = "test-account";

    // First write with original refresh_token
    writeAccountTokens(label, {
      access_token: "original_access",
      refresh_token: "original_refresh",
      token_type: "Bearer",
      expiry_date: Date.now() + 3600000,
      scope: "https://www.googleapis.com/auth/calendar",
    });

    // Second write with NEW refresh_token
    writeAccountTokens(label, {
      access_token: "new_access",
      refresh_token: "new_refresh",
      token_type: "Bearer",
      expiry_date: Date.now() + 3600000,
      scope: "https://www.googleapis.com/auth/calendar",
    });

    // Read back and verify refresh_token is updated
    const tokens = readAccountTokens(label);
    expect(tokens).not.toBeNull();
    expect(tokens?.access_token).toBe("new_access");
    expect(tokens?.refresh_token).toBe("new_refresh"); // Should be updated!
  });

  it("should not clobber refresh_token with undefined", () => {
    const label = "test-account";

    // First write with refresh_token
    writeAccountTokens(label, {
      access_token: "original_access",
      refresh_token: "original_refresh",
      token_type: "Bearer",
      expiry_date: Date.now() + 3600000,
      scope: "https://www.googleapis.com/auth/calendar",
    });

    // Second write with explicit undefined refresh_token
    writeAccountTokens(label, {
      access_token: "new_access",
      refresh_token: undefined,
      token_type: "Bearer",
      expiry_date: Date.now() + 3600000,
      scope: "https://www.googleapis.com/auth/calendar",
    });

    // Read back and verify refresh_token is NOT clobbered
    const tokens = readAccountTokens(label);
    expect(tokens).not.toBeNull();
    expect(tokens?.access_token).toBe("new_access");
    expect(tokens?.refresh_token).toBe("original_refresh"); // Should NOT be undefined!
  });

  it("should handle fresh write when no existing file", () => {
    const label = "new-account";

    // Write to non-existent account
    writeAccountTokens(label, {
      access_token: "new_access",
      refresh_token: "new_refresh",
      token_type: "Bearer",
      expiry_date: Date.now() + 3600000,
      scope: "https://www.googleapis.com/auth/calendar",
    });

    // Read back and verify all values
    const tokens = readAccountTokens(label);
    expect(tokens).not.toBeNull();
    expect(tokens?.access_token).toBe("new_access");
    expect(tokens?.refresh_token).toBe("new_refresh");
    expect(tokens?.token_type).toBe("Bearer");
    expect(tokens?.scope).toBe("https://www.googleapis.com/auth/calendar");
  });
});
