import { ZodError } from "zod";

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; code: string; message: string; requestId?: string };

export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 500) {
    super(message);
    this.name = "AppError";
  }
}

export function errorDetails(error: unknown) {
  if (error instanceof AppError) return { code: error.code, message: error.message, status: error.status };
  if (error && typeof error === "object" && "code" in error && error.code === "P2034") return { code: "WRITE_CONFLICT", message: "Project data changed during this operation. Retry after the other operation finishes.", status: 409 };
  if (error instanceof ZodError) return { code: "VALIDATION_ERROR", message: error.issues[0]?.message || "Invalid input", status: 400 };
  const name = error instanceof Error ? error.name : "";
  if (name === "AuthenticationError") return { code: "UNAUTHENTICATED", message: "Authentication required", status: 401 };
  if (name === "AuthorizationError") return { code: "FORBIDDEN", message: "You do not have permission to perform this action", status: 403 };
  if (name === "PlaygroundNotFoundError") return { code: "NOT_FOUND", message: "Playground not found", status: 404 };
  return { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again.", status: 500 };
}

export function actionSuccess<T>(data: T): ActionResult<T> {
  return { success: true, data };
}
