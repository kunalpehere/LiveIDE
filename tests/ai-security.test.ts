import { describe, expect, it } from "vitest";

import { chatRequestSchema, suggestionRequestSchema } from "@/features/ai-chat/server/schemas";
import { AIRequestError, enforceRateLimit, redactSensitiveContent } from "@/features/ai-chat/server/security";

describe("AI request controls", () => {
  it("validates and bounds chat and completion input", () => {
    expect(chatRequestSchema.safeParse({ message: "Help me", stream: true }).success).toBe(true);
    expect(chatRequestSchema.safeParse({ message: "x".repeat(12_001) }).success).toBe(false);
    expect(suggestionRequestSchema.safeParse({
      fileContent: "const value = 1", cursorLine: 0, cursorColumn: 5, suggestionType: "complete",
    }).success).toBe(true);
    expect(suggestionRequestSchema.safeParse({
      fileContent: "", cursorLine: -1, cursorColumn: 0, suggestionType: "complete",
    }).success).toBe(false);
  });

  it("redacts common secrets before provider submission", () => {
    const content = 'api_key="super-secret-value"\nconst token = "ghp_12345678901234567890"';
    const redacted = redactSensitiveContent(content);
    expect(redacted).not.toContain("super-secret-value");
    expect(redacted).not.toContain("ghp_12345678901234567890");
    expect(redacted).toContain("[REDACTED]");
  });

  it("rejects requests above the per-operation quota", () => {
    const user = `quota-test-${Date.now()}`;
    enforceRateLimit(user, "chat", 1);
    expect(() => enforceRateLimit(user, "chat", 1)).toThrowError(AIRequestError);
  });
});
