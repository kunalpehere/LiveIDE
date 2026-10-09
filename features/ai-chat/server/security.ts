import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { readLimitedBody, RESOURCE_LIMITS } from "@/lib/resource-limits";

const buckets = new Map<string, { count: number; resetAt: number }>();

export class AIRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "AIRequestError";
  }
}

export async function parseLimitedJson<T>(request: NextRequest, schema: z.ZodType<T>, maxBytes: number = RESOURCE_LIMITS.chatRequestBytes) {
  const raw = await readLimitedBody(request, maxBytes);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new AIRequestError(400, "INVALID_JSON", "Request body must be valid JSON"); }
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = [...result.error.issues];
    while (issues.length) {
      const issue = issues.shift()!;
      if (issue.code === "too_big") throw new AIRequestError(400, "VALIDATION_ERROR", issue.message);
      if (issue.code === "invalid_union") issues.push(...issue.unionErrors.flatMap(error => error.issues));
    }
    throw new AIRequestError(400, "VALIDATION_ERROR", result.error.issues[0]?.message || "Invalid request. Check the question and context and retry.");
  }
  return result.data;
}

export function enforceRateLimit(userId: string, operation: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  const key = `${userId}:${operation}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= limit) throw new AIRequestError(429, "RATE_LIMITED", "AI request quota exceeded. Please retry shortly.");
  current.count += 1;
}

const sensitivePatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
  /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["']?[^\s"']{8,}/gi,
  /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/g,
];

export function redactSensitiveContent(value: string) {
  return sensitivePatterns.reduce((content, pattern) => content.replace(pattern, "[REDACTED]"), value);
}

export function aiErrorResponse(error: unknown) {
  if (error instanceof AIRequestError || error instanceof AppError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "AuthenticationError") return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401 });
  if (name === "AuthorizationError") return NextResponse.json({ error: { code: "FORBIDDEN", message: "Playground access denied" } }, { status: 403 });
  if (name === "PlaygroundNotFoundError") return NextResponse.json({ error: { code: "NOT_FOUND", message: "Playground not found" } }, { status: 404 });
  logger.error("ai.route.failed", { code: "AI_UNAVAILABLE" }, error);
  return NextResponse.json({ error: { code: "AI_UNAVAILABLE", message: "AI service is unavailable" } }, { status: 502 });
}
