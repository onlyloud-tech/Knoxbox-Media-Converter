import express from "express";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";

const app = express();
const server = createServer(app);
app.use(express.json({ limit: "2mb" }));
registerRoutes(app);

if (process.env.NODE_ENV === "production") {
  serveStatic(app);
} else {
  const { setupVite } = await import("./vite");
  await setupVite(server, app);
}

const port = Number(process.env.PORT || 48721);
server.listen(port, "127.0.0.1", () => {
  console.log(`KnoxBox Movie Importer listening at http://127.0.0.1:${port}`);
});
