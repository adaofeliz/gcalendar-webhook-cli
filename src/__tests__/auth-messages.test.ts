import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Auth messages", () => {
  const googleAuthPath = path.join(__dirname, "../lib/google-auth.ts");
  const content = fs.readFileSync(googleAuthPath, "utf-8");

  it("should not contain 'login' as a command reference in user-facing strings", () => {
    expect(content).not.toMatch(/'login' command/);
    expect(content).not.toMatch(/"login" command/);
  });

  it("should not contain 'Login successful' message", () => {
    expect(content).not.toMatch(/Login successful/);
  });

  it("should contain 'auth' command references in error messages", () => {
    expect(content).toMatch(/'auth' command/);
  });

  it("should contain 'Authentication successful' message", () => {
    expect(content).toMatch(/Authentication successful/);
  });
});
