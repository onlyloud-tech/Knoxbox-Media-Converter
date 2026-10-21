import express from "express";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";

const app = express();
const server = createServer(app);
const port = Number(process.env.PORT || 48721);
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

// Binding to loopback keeps the API off the LAN. These checks also prevent
// browser pages on other origins (including DNS-rebound hosts) from using it.
app.use((request, response, next) => {
  const host = request.get("host")?.toLowerCase();
  const origin = request.get("origin")?.toLowerCase();
  if (!host || !allowedHosts.has(host) || (origin && origin !== `http://${host}`)) {
    response.status(403).json({ error: "This converter only accepts requests from its local app." });
    return;
  }
  next();
});
app.use(express.json({ limit: "2mb" }));
registerRoutes(app);

if (process.env.NODE_ENV === "production") {
  serveStatic(app);
} else {
  const { setupVite } = await import("./vite");
  await setupVite(server, app);
}

server.listen(port, "127.0.0.1", () => {
  console.log(`Knoxbox Media Converter listening at http://127.0.0.1:${port}`);
});
