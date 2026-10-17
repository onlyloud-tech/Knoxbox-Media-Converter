import assert from "assert";
import { spawnSync } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { createPack, generateDefinitions, installMovie, loadCatalog, removeMovie, saveSettings, setImportTarget } from "../server/kbm";

const testRoot = path.resolve(".integration-test");
const modRoot = path.join(testRoot, "KBM_TVVHS");
const source = path.join(testRoot, "Synthetic Movie.mp4");
const ffmpeg = process.env.KBM_FFMPEG || "";
const settingsPath = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local"), "KnoxboxMediaConverter", "settings.json");
const savedSettings = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath) : null;

async function restoreSettings() {
  if (savedSettings) {
    await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
    await fsp.writeFile(settingsPath, savedSettings);
  } else {
    await fsp.rm(settingsPath, { force: true });
  }
}

async function main() {
  await fsp.rm(testRoot, { recursive: true, force: true });
  await fsp.mkdir(path.join(modRoot, "common/media/lua/client/KBMGB/Movie"), { recursive: true });
  await fsp.writeFile(path.join(modRoot, "common/media/lua/client/KBMGB/Movie/MovieRegistry.lua"), "return {}\n");
  await fsp.mkdir(path.dirname(source), { recursive: true });
  const generated = spawnSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=size=640x360:rate=2",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "31", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source,
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(generated.status, 0, generated.stderr);

  await saveSettings(modRoot, testRoot);
  await setImportTarget("local");
  const phases: string[] = [];
  const entry = await installMovie(source, "Synthetic Movie.mp4", "Synthetic Movie", (phase) => phases.push(phase));
  const catalog = await loadCatalog();
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].id, entry.id);
  assert.equal(entry.audioChunks, 1);
  assert.equal(entry.audioLayout, "single");
  assert(fs.existsSync(path.join(modRoot, "common/media/video", entry.video)));
  assert(fs.existsSync(path.join(modRoot, "common/media/sound/KBM/UserMovies", entry.id, "audio.ogg")));
  assert(fs.existsSync(path.join(modRoot, "common/media/lua/shared/KBMGB/Movie/UserMovieCatalog.lua")));
  assert(fs.existsSync(path.join(modRoot, "common/media/scripts/KBMGB_UserMovie_Items.txt")));
  assert(fs.existsSync(path.join(modRoot, "common/media/scripts/KBMGB_UserMovie_Sounds.txt")));
  assert(phases.includes("Encoding video"));
  assert(phases.includes("Encoding audio"));
  assert.equal(phases.at(-1), "Installed - restart Project Zomboid");

  const inspection = spawnSync(ffmpeg, ["-hide_banner", "-i", path.join(modRoot, "common/media/video", entry.video)], { encoding: "utf8", windowsHide: true });
  const probeText = `${inspection.stdout}\n${inspection.stderr}`;
  assert(probeText.includes("Video: h264 (Constrained Baseline)"), probeText);
  assert(probeText.includes("320x180"), probeText);
  const audioInspection = spawnSync(ffmpeg, ["-hide_banner", "-i", path.join(modRoot, "common/media/sound/KBM/UserMovies", entry.id, "audio.ogg")], { encoding: "utf8", windowsHide: true });
  const audioProbeText = `${audioInspection.stdout}\n${audioInspection.stderr}`;
  assert(audioProbeText.includes("32000 Hz, mono"), audioProbeText);
  assert(audioProbeText.includes("Duration: 00:00:31"), audioProbeText);
  const sounds = await fsp.readFile(path.join(modRoot, "common/media/scripts/KBMGB_UserMovie_Sounds.txt"), "utf8");
  assert(sounds.includes(`/audio.ogg`));
  assert(!sounds.includes(`seg_001.ogg`));
  const generatedCatalog = await fsp.readFile(path.join(modRoot, "common/media/lua/shared/KBMGB/Movie/UserMovieCatalog.lua"), "utf8");
  assert(generatedCatalog.includes(`audioLayout="single"`));
  await generateDefinitions(modRoot, [{ ...entry, audioLayout: "chunks", audioChunks: 2 }]);
  const legacySounds = await fsp.readFile(path.join(modRoot, "common/media/scripts/KBMGB_UserMovie_Sounds.txt"), "utf8");
  assert(legacySounds.includes(`seg_000.ogg`) && legacySounds.includes(`seg_001.ogg`));

  await removeMovie(entry.id);
  assert.equal((await loadCatalog()).length, 0);
  await generateDefinitions(modRoot, []);

  const regenerated = spawnSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=2",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "31", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source,
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(regenerated.status, 0, regenerated.stderr);
  const imagePath = path.join(testRoot, "pack-image.png");
  const generatedImage = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256", "-frames:v", "1", imagePath], { encoding: "utf8", windowsHide: true });
  assert.equal(generatedImage.status, 0, generatedImage.stderr);
  const image = await fsp.readFile(imagePath);
  const pack = await createPack({ modId: "KBM_TestMovies", name: "Test Movies", description: "Generated integration-test pack", image });
  const packEntry = await installMovie(source, "Synthetic Movie.mp4", "Synthetic Pack Movie", () => undefined);
  assert.equal((await loadCatalog()).length, 1);
  assert.equal(packEntry.itemType, `KBM_TestMovies_Movies.VHS_${packEntry.id}`);
  assert(fs.existsSync(path.join(pack.root, "42/mod.info")));
  assert(fs.existsSync(path.join(pack.root, "42/media/video/KBM_TestMovies_Movies", `${packEntry.id}.mp4`)));
  assert(fs.existsSync(path.join(pack.root, "42/media/sound/KBM/KBM_TestMovies_Movies", packEntry.id, "audio.ogg")));
  assert(fs.existsSync(path.join(pack.root, "42/media/lua/shared/KBM_TestMovies_Movies/Register.lua")));
  assert(fs.existsSync(path.join(pack.root, "42/media/lua/server/Items/KBM_TestMovies_MoviesDistributions.lua")));
  const modInfo = await fsp.readFile(path.join(pack.root, "42/mod.info"), "utf8");
  assert(modInfo.includes("require=KBM_TVVHS"));
  assert(modInfo.includes("poster=poster.png"));
  assert(fs.existsSync(path.join(pack.root, "42/poster.png")));
  assert(fs.existsSync(path.join(pack.root, "preview.png")));
  await setImportTarget("local");
  await fsp.rm(testRoot, { recursive: true, force: true });
  await restoreSettings();
  console.log("Integration test passed: local install/removal and standalone movie-pack generation.");
}

main().catch(async (error) => {
  console.error(error);
  await fsp.rm(testRoot, { recursive: true, force: true });
  await restoreSettings();
  process.exit(1);
});
