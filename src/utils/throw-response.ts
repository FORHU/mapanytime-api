/**
 * throwResponse — Throws a structured error for the global error middleware.
 *
 * Use this inside Services and Repositories instead of `throw new Error(...)`.
 * The global error handler catches the shape and formats it as a proper JSON
 * API error response automatically.
 *
 * Usage:
 *   throwResponse(404, "User not found");
 *   throwResponse(409, "Email already taken", { conflictField: "email" });
 *   throwResponse(403, "Insufficient permissions", { requiredRole: "admin" });
 */
export function throwResponse(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): never {
  throw { status, message, ...(extra || {}) };
}
