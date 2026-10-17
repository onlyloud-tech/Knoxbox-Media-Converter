import type { Express } from "express";
import type { Server } from "http";
import { createServer as createViteServer } from "vite";
import viteConfig from "../vite.config";

export async function setupVite(server: Server, app: Express) {
  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
