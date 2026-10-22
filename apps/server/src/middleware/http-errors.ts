import type { HttpErrorResponse } from "@lara/contracts";
import type {
  ErrorRequestHandler,
  RequestHandler,
} from "express";

/**
 * Identify expected invalid HTTP request data.
 */
export class RequestValidationError extends Error {
  constructor() {
    super("Invalid request data");
    this.name = "RequestValidationError";
  }
}

/**
 * Identify unsupported request body media types.
 */
export class UnsupportedMediaTypeError extends Error {
  constructor() {
    super("Unsupported media type");
    this.name = "UnsupportedMediaTypeError";
  }
}

/** Handle requests that do not match a registered route. */
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

  if (error instanceof UnsupportedMediaTypeError) {
    const body: HttpErrorResponse = {
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Unsupported media type",
      },
    };

    response.status(415).json(body);
    return;
  }

  // Express's router marks malformed route decoding with URIError/status 400.
  const isRouteDecodingError =
    error instanceof URIError && "status" in error && error.status === 400;

  if (error instanceof RequestValidationError || isRouteDecodingError) {
    const body: HttpErrorResponse = {
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request data",
      },
    };

    response.status(400).json(body);
    return;
  }

  // Recognize known JSON parser errors by type and status.
  const parserType =
    error instanceof Error && "type" in error ? error.type : undefined;
  const parserStatus =
    error instanceof Error && "status" in error ? error.status : undefined;

  if (
    (parserType === "charset.unsupported" ||
      parserType === "encoding.unsupported") &&
    parserStatus === 415
  ) {
    const body: HttpErrorResponse = {
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Unsupported media type",
      },
    };

    response.status(415).json(body);
    return;
  }

  if (parserType === "entity.parse.failed" && parserStatus === 400) {
    const body: HttpErrorResponse = {
      error: {
        code: "INVALID_JSON",
        message: "Invalid JSON request body",
      },
    };
    response.status(400).json(body);
    return;
  }

  if (parserType === "entity.too.large" && parserStatus === 413) {
    const body: HttpErrorResponse = {
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "JSON request body exceeds size limit",
      },
    };
    response.status(413).json(body);
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
