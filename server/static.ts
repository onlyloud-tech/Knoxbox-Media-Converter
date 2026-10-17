import express, { type Express } from "express";
import path from "path";

export function serveStatic(app: Express) {
  const publicPath = path.resolve(__dirname, "public");
  app.use(express.static(publicPath));
  app.use("/{*path}", (_request, response) => response.sendFile(path.join(publicPath, "index.html")));
}
