import type { Express } from "express";
import multer from "multer";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import fsp from "fs/promises";
import { Transform, pipeline } from "stream";
import { checkConversionSpace, checkReserve, checkUploadSpace, InsufficientSpaceError } from "./disk";
import { APP_VERSION, createPack, findFfmpeg, getPack, installMovie, isPzRunning, isValidModRoot, isWorkshopModRoot, listPacks, loadCatalog, loadSettings, removeMovie, resolveImportTarget, saveSettings, setImportTarget, stagePackForWorkshop, workshopRoot, type Target } from "./kbm";

type Job = {
  id: string;
  sourceName: string;
  title: string;
  phase: string;
  progress: number;
  status: "queued" | "running" | "complete" | "failed";
  error?: string;
  uploadPath: string;
  uploadSize: number;
};

const maxUploadFiles = 10;
const maxUploadBytes = 64 * 1024 * 1024 * 1024;
const maxQueuedBytes = 96 * 1024 * 1024 * 1024;
const maxQueuedJobs = 250;
const maxJobHistory = 500;
const maxConcurrentUploads = 2;
const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "kbm-movie-uploads-"));
process.once("exit", () => { try { fs.rmSync(uploadDirectory, { recursive: true, force: true }); } catch { /* Windows may still have an open FFmpeg handle. */ } });
const requestBytes = new WeakMap<object, number>();
const requestPaths = new WeakMap<object, Set<string>>();
const requestTargets = new WeakMap<object, Target>();
const requestExpectedBytes = new WeakMap<object, number>();
const requestNextSpaceCheck = new WeakMap<object, number>();
let activeUploads = 0;
let inFlightBytes = 0;
const uploadStorage: multer.StorageEngine = {
  _handleFile(request, file, callback) {
    try { fs.mkdirSync(uploadDirectory, { recursive: true }); }
    catch (error) { callback(error as Error); return; }
    const filename = randomUUID();
    const filePath = path.join(uploadDirectory, filename);
    requestPaths.get(request)?.add(filePath);
    let fileSize = 0;
    const meter = new Transform({ transform(chunk: Buffer, _encoding, done) {
      const total = (requestBytes.get(request) || 0) + chunk.length;
      if (total > maxUploadBytes) { done(new Error("Upload batch exceeds 64 GiB.")); return; }
      if (inFlightBytes + activeJobs().reduce((sum, job) => sum + job.uploadSize, 0) + chunk.length > maxQueuedBytes) {
        done(new Error("The import queue has reached its disk budget.")); return;
      }
      try {
        if (total >= (requestNextSpaceCheck.get(request) || 0)) {
          const target = requestTargets.get(request);
          if (!target) throw new Error("The import target is unavailable.");
          checkConversionSpace(uploadDirectory, target.root, requestExpectedBytes.get(request) || total);
          checkReserve(uploadDirectory);
          requestNextSpaceCheck.set(request, total + 32 * 1024 * 1024);
        }
      } catch (error) { done(error as Error); return; }
      requestBytes.set(request, total);
      inFlightBytes += chunk.length;
      fileSize += chunk.length;
      done(null, chunk);
    } });
    pipeline(file.stream, meter, fs.createWriteStream(filePath, { flags: "wx" }), (error) => {
      if (error) { requestPaths.get(request)?.delete(filePath); fs.rm(filePath, { force: true }, () => callback(error)); return; }
      callback(null, { destination: uploadDirectory, filename, path: filePath, size: fileSize });
    });
  },
  _removeFile(request, file, callback) { requestPaths.get(request)?.delete(file.path); fs.rm(file.path, { force: true }, callback); },
};
const upload = multer({ storage: uploadStorage, limits: { fileSize: 25 * 1024 * 1024 * 1024, files: maxUploadFiles, fields: 1, parts: maxUploadFiles + 1, fieldSize: 128 * 1024 },
  fileFilter: (_request, file, callback) => /\.(?:mp4|mkv|mov|avi|webm|m4v|ogv)$/i.test(file.originalname)
    ? callback(null, true) : callback(new Error("Only MP4, MKV, MOV, AVI, WebM, M4V, and OGV videos can be imported.")),
});
const packImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => file.mimetype === "image/png" && /\.png$/i.test(file.originalname) ? callback(null, true) : callback(new Error("Pack image must be a PNG file.")),
});
const jobs = new Map<string, Job>();
let queue = Promise.resolve();
function activeJobs() { return [...jobs.values()].filter(job => job.status === "queued" || job.status === "running"); }
function pruneHistory() {
  for (const [id, job] of jobs) {
    if (jobs.size <= maxJobHistory) break;
    if (job.status === "complete" || job.status === "failed") jobs.delete(id);
  }
}

function publicJob(job: Job) {
  const { uploadPath: _uploadPath, ...visible } = job;
  return visible;
}

function queueJob(job: Job, target: Target) {
  queue = queue.then(async () => {
    job.status = "running";
    try {
      await installMovie(job.uploadPath, job.sourceName, job.title, (phase, progress) => {
        job.phase = phase;
        job.progress = Math.max(job.progress, Math.min(100, progress));
      }, target);
      job.status = "complete";
      job.progress = 100;
    } catch (error) {
      job.status = "failed";
      job.phase = "Import failed";
      job.error = error instanceof Error ? error.message : String(error);
      await fsp.rm(job.uploadPath, { force: true });
    }
    pruneHistory();
  });
}

export function registerRoutes(app: Express) {
  app.get("/api/status", async (_request, response) => {
    const settings = loadSettings();
    response.json({ ...settings, workshopRoot: workshopRoot(settings.modsRoot), activePack: getPack(settings.activePackId, settings.modsRoot), packs: await listPacks(settings.modsRoot), modFound: isValidModRoot(settings.modRoot), steamMod: isWorkshopModRoot(settings.modRoot), pzRunning: await isPzRunning(), ffmpegFound: Boolean(findFfmpeg()), version: APP_VERSION });
  });

  app.put("/api/settings", async (request, response) => {
    try {
      if (activeJobs().length) throw new Error("Wait for movie imports to finish before changing folders.");
      response.json(await saveSettings(String(request.body?.modRoot || ""), String(request.body?.modsRoot || "")));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/packs", packImageUpload.single("image"), async (request, response) => {
    try {
      if (activeJobs().length) throw new Error("Wait for movie imports to finish before creating a pack.");
      response.status(201).json(await createPack({ modId: String(request.body?.modId || ""), name: String(request.body?.name || ""), description: String(request.body?.description || ""), image: request.file?.buffer }));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/packs/:modId/stage-workshop", async (request, response) => {
    try {
      if(activeJobs().length) throw new Error("Wait for all movie imports to finish before staging this pack.");
      response.json(await stagePackForWorkshop(request.params.modId));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put("/api/target", async (request, response) => {
    try {
      if (activeJobs().length) throw new Error("Wait for movie imports to finish before changing targets.");
      const mode = request.body?.mode === "pack" ? "pack" : "local";
      response.json(await setImportTarget(mode, String(request.body?.activePackId || "")));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/library", async (_request, response) => {
    const { modRoot } = loadSettings();
    response.json(isValidModRoot(modRoot) && !(loadSettings().mode === "local" && isWorkshopModRoot(modRoot)) ? await loadCatalog() : []);
  });

  app.get("/api/jobs", (_request, response) => response.json([...jobs.values()].map(publicJob)));

  app.post("/api/import", async (request, response, next) => {
    try {
      if (activeUploads >= maxConcurrentUploads) return response.status(429).json({ error: "Too many uploads are in progress. Try again when one finishes." });
      if (activeJobs().length >= maxQueuedJobs) return response.status(429).json({ error: "The movie queue is full. Wait for imports to finish." });
      const contentLength = Number(request.get("content-length") || 0);
      if (!Number.isSafeInteger(contentLength) || contentLength <= 0) return response.status(411).json({ error: "The upload size is required before importing movies." });
      if (contentLength > maxUploadBytes + 1024 * 1024) return response.status(413).json({ error: "Upload batch exceeds 64 GiB." });
      if (await isPzRunning()) return response.status(409).json({ error: "Project Zomboid is running. Close it before importing movies." });
      if (activeUploads >= maxConcurrentUploads) return response.status(429).json({ error: "Too many uploads are in progress. Try again when one finishes." });
      const target = resolveImportTarget();
      checkUploadSpace(uploadDirectory, target.root, contentLength);
      (request as typeof request & { kbmTarget: Target }).kbmTarget = target;
      requestTargets.set(request, target);
      requestExpectedBytes.set(request, contentLength);
      activeUploads++;
      requestPaths.set(request, new Set());
      response.once("close", () => {
        activeUploads--;
        inFlightBytes -= requestBytes.get(request) || 0;
        for (const file of requestPaths.get(request) || []) void fsp.rm(file, { force: true });
      });
      next();
    } catch (error) { response.status(error instanceof InsufficientSpaceError ? 507 : 400).json({ error: error instanceof Error ? error.message : String(error) }); }
  }, upload.array("files", maxUploadFiles), async (request, response) => {
    const files = (request.files || []) as Express.Multer.File[];
    if (!files.length) return response.status(400).json({ error: "No movie files were selected." });
    const target = (request as typeof request & { kbmTarget: Target }).kbmTarget;
    if (!target || files.some(file => file.originalname.length > 260)) {
      await Promise.all(files.map((file) => fsp.rm(file.path, { force: true })));
      return response.status(400).json({ error: "An upload filename or target is invalid." });
    }
    if (await isPzRunning()) {
      await Promise.all(files.map((file) => fsp.rm(file.path, { force: true })));
      return response.status(409).json({ error: "Project Zomboid is running. Close it before importing movies." });
    }
    const pending=activeJobs();
    if (pending.length + files.length > maxQueuedJobs
        || pending.reduce((sum, job) => sum + job.uploadSize, 0) + files.reduce((sum, file) => sum + file.size, 0) > maxQueuedBytes) {
      await Promise.all(files.map(file => fsp.rm(file.path, { force: true })));
      return response.status(429).json({ error: "The import queue is full. Wait for imports to finish." });
    }
    try { checkConversionSpace(uploadDirectory, target.root, files.reduce((sum, file) => sum + file.size, 0)); }
    catch (error) {
      await Promise.all(files.map(file => fsp.rm(file.path, { force: true })));
      return response.status(error instanceof InsufficientSpaceError ? 507 : 400).json({ error: error instanceof Error ? error.message : String(error) });
    }
    let titles: Array<{ name: string; title: string }> = [];
    try {
      const parsed: unknown = JSON.parse(String(request.body?.titles || "[]"));
      if (Array.isArray(parsed)) titles = parsed.filter(entry => typeof entry?.name === "string" && typeof entry?.title === "string" && entry.name.length <= 260 && entry.title.length <= 120).slice(0, maxUploadFiles);
    } catch { /* use filenames */ }
    pruneHistory();
    const created = files.map((file) => {
      const requested = titles.find((entry) => entry.name === file.originalname)?.title;
      const job: Job = {
        id: randomUUID(), sourceName: file.originalname,
        title: String(requested || path.parse(file.originalname).name).trim(),
        phase: "Queued", progress: 0, status: "queued", uploadPath: file.path, uploadSize: file.size,
      };
      jobs.set(job.id, job);
      requestPaths.get(request)?.delete(file.path);
      queueJob(job, target);
      return publicJob(job);
    });
    response.status(202).json({ jobs: created });
  });

  app.delete("/api/library/:id", async (request, response) => {
    try {
      if (activeJobs().length) throw new Error("Wait for movie imports to finish before removing a movie.");
      await removeMovie(request.params.id);
      response.json({ ok: true });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.use((error: unknown, _request: unknown, response: any, _next: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    response.status(error instanceof InsufficientSpaceError ? 507 : message.includes("File too large") ? 413 : 500).json({ error: message });
  });
}
