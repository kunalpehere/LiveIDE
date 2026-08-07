import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AppError, actionSuccess, errorDetails } from "@/lib/errors";

describe("application error contract", () => {
  it("returns serializable success values", () => {
    expect(actionSuccess({ id: "one" })).toEqual({ success: true, data: { id: "one" } });
  });

  it("maps expected failures to stable public codes", () => {
    expect(errorDetails(new AppError("SAVE_CONFLICT", "Reload", 409))).toEqual({
      code: "SAVE_CONFLICT", message: "Reload", status: 409,
    });
    const invalid = z.string().min(3).safeParse("x");
    if (!invalid.success) expect(errorDetails(invalid.error).code).toBe("VALIDATION_ERROR");
  });

  it("does not expose unexpected internal error messages", () => {
    expect(errorDetails(new Error("database password leaked"))).toEqual({
      code: "INTERNAL_ERROR", message: "Something went wrong. Please try again.", status: 500,
    });
  });
});
