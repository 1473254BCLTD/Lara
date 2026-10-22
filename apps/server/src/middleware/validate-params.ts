import type {
  Request,
  RequestHandler,
  Response,
} from "express";
import type { z } from "zod";

import { RequestValidationError } from "./http-errors.js";

/**
 * Validate route parameters and pass their parsed output
 * to a strongly typed handler.
 *
 * Validation does not establish authentication or authorization.
 */
export function withValidatedParams<TSchema extends z.ZodType>(
  schema: TSchema,
  handler: (
    params: z.output<TSchema>,
    request: Request,
    response: Response,
  ) => void | Promise<void>,
): RequestHandler {
  return async (request, response) => {
    const result = await schema.safeParseAsync(request.params);

    if (!result.success) {
      throw new RequestValidationError();
    }

    await handler(result.data, request, response);
  };
}
