/**
 * Plan 10 — shared error classes for the squads server layer.
 *
 * Route handlers translate these into HTTP codes:
 *   ConflictError   → 409
 *   ValidationError → 400
 *   PermissionError → 403 (or 401 for unauthenticated)
 */

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}
