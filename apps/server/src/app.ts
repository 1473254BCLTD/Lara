import express from "express";

import {
  errorHandler,
  notFoundHandler,
} from "./middleware/http-errors.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  // Feature routes will be registered here.

  // Handle unmatched requests.
  app.use(notFoundHandler);

  // Error handling must be registered last.
  app.use(errorHandler);

  return app;
}
