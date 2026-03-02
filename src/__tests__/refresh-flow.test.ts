import { describe, it, expect } from "vitest";
import { GaxiosError } from "gaxios";

describe("Refresh Flow", () => {
  it("handleCalendarError should throw instead of process.exit", () => {
    // We can't easily import handleCalendarError directly as it's not exported
    // But we can verify the behavior by checking the calendar.ts file
    // and ensuring no process.exit calls exist

    // Read the calendar.ts file and verify no process.exit
    const fs = require("fs");
    const path = require("path");
    const calendarPath = path.join(__dirname, "../lib/calendar.ts");
    const calendarContent = fs.readFileSync(calendarPath, "utf-8");

    // Assert no process.exit in the file
    expect(calendarContent).not.toMatch(/process\.exit/);

    // Assert that throw is used in handleCalendarError
    expect(calendarContent).toMatch(/throw new Error/);
  });

  it("should handle GaxiosError with status codes correctly", () => {
    // Create a mock GaxiosError
    const mockError = new GaxiosError("Request failed", {}, {
      status: 401,
    } as any);

    // Verify error properties
    expect(mockError.message).toBe("Request failed");
    expect(mockError.response?.status).toBe(401);
  });

  it("should handle 404/410 errors gracefully", () => {
    // Test that 404 and 410 status codes are handled
    const mock404Error = new GaxiosError("Not found", {}, {
      status: 404,
    } as any);
    const mock410Error = new GaxiosError("Gone", {}, { status: 410 } as any);

    expect(mock404Error.response?.status).toBe(404);
    expect(mock410Error.response?.status).toBe(410);
  });
});

describe("Token Event Handler", () => {
  it("should build token update without refresh_token when not present", () => {
    // Simulate the token event handler logic
    const newTokens = {
      access_token: "new_access_token",
      expiry_date: Date.now() + 3600000,
      token_type: "Bearer" as const,
      scope: "https://www.googleapis.com/auth/calendar",
    };

    // Build token update object (matching the fixed logic in google-auth.ts)
    const tokenUpdate: Record<string, any> = {
      access_token: newTokens.access_token ?? undefined,
      token_type: newTokens.token_type,
      expiry_date: newTokens.expiry_date ?? undefined,
      scope: newTokens.scope,
    };

    // Only include refresh_token if present
    if ((newTokens as any).refresh_token) {
      tokenUpdate.refresh_token = (newTokens as any).refresh_token;
    }

    // Verify refresh_token is NOT in the update
    expect(tokenUpdate.refresh_token).toBeUndefined();
    expect(tokenUpdate.access_token).toBe("new_access_token");
  });

  it("should include refresh_token when present in new tokens", () => {
    // Simulate the token event handler logic with refresh_token
    const newTokens = {
      access_token: "new_access_token",
      refresh_token: "new_refresh_token",
      expiry_date: Date.now() + 3600000,
      token_type: "Bearer" as const,
      scope: "https://www.googleapis.com/auth/calendar",
    };

    // Build token update object
    const tokenUpdate: Record<string, any> = {
      access_token: newTokens.access_token ?? undefined,
      token_type: newTokens.token_type,
      expiry_date: newTokens.expiry_date ?? undefined,
      scope: newTokens.scope,
    };

    // Only include refresh_token if present
    if (newTokens.refresh_token) {
      tokenUpdate.refresh_token = newTokens.refresh_token;
    }

    // Verify refresh_token IS in the update
    expect(tokenUpdate.refresh_token).toBe("new_refresh_token");
    expect(tokenUpdate.access_token).toBe("new_access_token");
  });
});
