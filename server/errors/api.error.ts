export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class BadRequestError extends ApiError {
  constructor(message = "Bad request.") {
    super(400, message);
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Authentication required.") {
    super(401, message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Access denied.") {
    super(403, message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Resource not found.") {
    super(404, message);
    this.name = "NotFoundError";
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(message = "Service temporarily unavailable.") {
    super(503, message);
    this.name = "ServiceUnavailableError";
  }
}
