export class PersistenceError extends Error {
  constructor(message: string, readonly code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "IDEMPOTENCY_CONFLICT") {
    super(message)
    this.name = "PersistenceError"
  }
}

export class NotFoundError extends PersistenceError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, "NOT_FOUND")
  }
}

export class TenantAccessError extends PersistenceError {
  constructor(resource: string, id: string) {
    super(`Tenant cannot access ${resource}: ${id}`, "FORBIDDEN")
  }
}

export class ConflictError extends PersistenceError {
  constructor(message: string) {
    super(message, "CONFLICT")
  }
}

export class IdempotencyConflictError extends PersistenceError {
  constructor(key: string) {
    super(`Idempotency key has a different request: ${key}`, "IDEMPOTENCY_CONFLICT")
  }
}
