import type { HttpErrorResponse } from "@lara/contracts";
import type {
  ErrorRequestHandler,
  RequestHandler,
} from "express";

/**
 * Handle requests that do not match a registered route.
 */
export const notFoundHandler: RequestHandler = (
  _request,
  response,
) => {
  const body: HttpErrorResponse = {
    error: {
      code: "NOT_FOUND",
      message: "Resource not found",
    },
  };

  response.status(404).json(body);
};

/**
 * Handle unexpected errors without exposing internal details.
 */
export const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  next,
) => {
  // Delegate when the response has already started.
  if (response.headersSent) {
    next(error);
    return;
  }

  // Internal diagnostics stay on the server.
  console.error("Unhandled API error:", error);

  const body: HttpErrorResponse = {
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    },
  };

  response.status(500).json(body);
};
