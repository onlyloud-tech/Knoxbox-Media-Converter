import express from "express";
import { createServer } from "http";
import { timingSafeEqual } from "crypto";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";

const app = express();
const server = createServer(app);
const port = Number(process.env.PORT || 48721);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid local server port.");
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const apiToken = process.env.KBM_API_TOKEN;
if (process.env.NODE_ENV === "production" && !/^[a-f0-9]{64}$/.test(apiToken || "")) {
  throw new Error("The packaged converter requires an Electron session token.");
}

app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  if (process.env.NODE_ENV === "production") {
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  }
  next();
});
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
app.use("/api", (request, response, next) => {
  if (apiToken) {
    const cookie = request.get("cookie")?.split(";").map(part => part.trim())
      .find(part => part.startsWith("kbm_session="))?.slice("kbm_session=".length) || "";
    if (!/^[a-f0-9]{64}$/.test(cookie)
        || !timingSafeEqual(Buffer.from(cookie, "hex"), Buffer.from(apiToken, "hex"))) {
      response.status(401).json({ error: "This session is not authorized to use the converter." });
      return;
    }
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
