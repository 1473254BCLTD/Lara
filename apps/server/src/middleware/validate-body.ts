import type {
  Request,
  RequestHandler,
  Response,
} from "express";
import { z } from "zod";

import {
  RequestValidationError,
  UnsupportedMediaTypeError,
} from "./http-errors.js";

/**
 * Validate a JSON request body and pass its parsed output
 * to a strongly typed handler.
 *
 * Validation does not establish authentication or authorization.
 */
export function withValidatedBody<TSchema extends z.ZodType>(
  schema: TSchema,
  handler: (
    body: z.output<TSchema>,
    request: Request,
    response: Response,
  ) => void | Promise<void>,
): RequestHandler {
  return async (request, response) => {
    // Reject unsupported media types when a body is present.
    if (request.is("application/json") === false) {
      throw new UnsupportedMediaTypeError();
    }

    const result = await schema.safeParseAsync(request.body);

    if (!result.success) {
      throw new RequestValidationError();
    }

    await handler(result.data, request, response);
  };
}
