import type {
  Request,
  RequestHandler,
  Response,
} from "express";
import type { z } from "zod";

import { RequestValidationError } from "./http-errors.js";

/**
 * Validate query parameters and pass their parsed output
 * to a strongly typed handler.
 *
 * Validation does not establish authentication or authorization.
 */
export function withValidatedQuery<TSchema extends z.ZodType>(
  schema: TSchema,
  handler: (
    query: z.output<TSchema>,
    request: Request,
    response: Response,
  ) => void | Promise<void>,
): RequestHandler {
  return async (request, response) => {
    const result = await schema.safeParseAsync(request.query);

    if (!result.success) {
      throw new RequestValidationError();
    }

    await handler(result.data, request, response);
  };
}
