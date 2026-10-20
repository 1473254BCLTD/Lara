import express from "express";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  return app;
}
