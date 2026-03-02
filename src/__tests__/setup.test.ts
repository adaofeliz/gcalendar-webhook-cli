import { describe, it, expect } from "vitest";
import { computeWebhookStatus } from "../types/index.js";

describe("Setup", () => {
  it("should import modules correctly", () => {
    const status = computeWebhookStatus(Date.now() + 86400000 * 4); // 4 days from now
    expect(status).toBe("active");
  });
});
