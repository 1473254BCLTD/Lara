import { z } from "zod";

/**
 * Public error response returned by the Lara API.
 *
 * Error codes are stable, machine-readable identifiers.
 * Messages are safe for clients to display.
 */
export const httpErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});

export type HttpErrorResponse = z.infer<
  typeof httpErrorResponseSchema
>;
