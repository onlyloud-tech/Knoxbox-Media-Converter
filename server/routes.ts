import type { Express } from "express";
import multer from "multer";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import fsp from "fs/promises";
import { APP_VERSION, createPack, findFfmpeg, getPack, installMovie, isPzRunning, isValidModRoot, listPacks, loadCatalog, loadSettings, removeMovie, saveSettings, setImportTarget } from "./kbm";

type Job = {
  id: string;
  sourceName: string;
  title: string;
  phase: string;
  progress: number;
  status: "queued" | "running" | "complete" | "failed";
  error?: string;
  uploadPath: string;
};

const maxUploadFiles = 250;
const upload = multer({ dest: path.join(os.tmpdir(), "kbm-movie-uploads"), limits: { fileSize: 25 * 1024 * 1024 * 1024, files: maxUploadFiles } });
const packImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => file.mimetype === "image/png" && /\.png$/i.test(file.originalname) ? callback(null, true) : callback(new Error("Pack image must be a PNG file.")),
});
const jobs = new Map<string, Job>();
let queue = Promise.resolve();

function publicJob(job: Job) {
  const { uploadPath: _uploadPath, ...visible } = job;
  return visible;
}

function queueJob(job: Job) {
  queue = queue.then(async () => {
    job.status = "running";
    try {
      await installMovie(job.uploadPath, job.sourceName, job.title, (phase, progress) => {
        job.phase = phase;
        job.progress = Math.max(job.progress, Math.min(100, progress));
      });
      job.status = "complete";
      job.progress = 100;
    } catch (error) {
      job.status = "failed";
      job.phase = "Import failed";
      job.error = error instanceof Error ? error.message : String(error);
      await fsp.rm(job.uploadPath, { force: true });
    }
  });
}

export function registerRoutes(app: Express) {
  app.get("/api/status", async (_request, response) => {
    const settings = loadSettings();
    response.json({ ...settings, activePack: getPack(settings.activePackId, settings.modsRoot), packs: await listPacks(settings.modsRoot), modFound: isValidModRoot(settings.modRoot), pzRunning: await isPzRunning(), ffmpegFound: Boolean(findFfmpeg()), version: APP_VERSION });
  });

  app.put("/api/settings", async (request, response) => {
    try {
      response.json(await saveSettings(String(request.body?.modRoot || ""), String(request.body?.modsRoot || "")));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/packs", packImageUpload.single("image"), async (request, response) => {
    try {
      response.status(201).json(await createPack({ modId: String(request.body?.modId || ""), name: String(request.body?.name || ""), description: String(request.body?.description || ""), image: request.file?.buffer }));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put("/api/target", async (request, response) => {
    try {
      const mode = request.body?.mode === "pack" ? "pack" : "local";
      response.json(await setImportTarget(mode, String(request.body?.activePackId || "")));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/library", async (_request, response) => {
    const { modRoot } = loadSettings();
    response.json(isValidModRoot(modRoot) ? await loadCatalog() : []);
  });

  app.get("/api/jobs", (_request, response) => response.json([...jobs.values()].map(publicJob)));

  app.post("/api/import", upload.array("files", maxUploadFiles), async (request, response) => {
    const files = (request.files || []) as Express.Multer.File[];
    if (!files.length) return response.status(400).json({ error: "No movie files were selected." });
    const { modRoot } = loadSettings();
    if (!isValidModRoot(modRoot)) {
      await Promise.all(files.map((file) => fsp.rm(file.path, { force: true })));
      return response.status(400).json({ error: "Configure a valid KBM_TVVHS folder first." });
    }
    if (await isPzRunning()) {
      await Promise.all(files.map((file) => fsp.rm(file.path, { force: true })));
      return response.status(409).json({ error: "Project Zomboid is running. Close it before importing movies." });
    }
    let titles: Array<{ name: string; title: string }> = [];
    try { titles = JSON.parse(String(request.body.titles || "[]")); } catch { /* use filenames */ }
    const created = files.map((file) => {
      const requested = titles.find((entry) => entry.name === file.originalname)?.title;
      const job: Job = {
        id: randomUUID(), sourceName: file.originalname,
        title: String(requested || path.parse(file.originalname).name).trim(),
        phase: "Queued", progress: 0, status: "queued", uploadPath: file.path,
      };
      jobs.set(job.id, job);
      queueJob(job);
      return publicJob(job);
    });
    response.status(202).json({ jobs: created });
  });

  app.delete("/api/library/:id", async (request, response) => {
    try {
      await removeMovie(request.params.id);
      response.json({ ok: true });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.use((error: unknown, _request: unknown, response: any, _next: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    response.status(message.includes("File too large") ? 413 : 500).json({ error: message });
  });
}
