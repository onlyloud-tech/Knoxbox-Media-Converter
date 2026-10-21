import assert from "assert";
import { spawnSync } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { createPack, generateDefinitions, installMovie, isWorkshopModRoot, loadCatalog, removeMovie, saveSettings, setImportTarget, stagePackForWorkshop } from "../server/kbm";

const testRoot = path.resolve(".integration-test");
const modRoot = path.join(testRoot, "KBM_TVVHS");
const source = path.join(testRoot, "Synthetic Movie.mp4");
const ffmpeg = process.env.KBM_FFMPEG || "";
const settingsPath = path.join(process.env.KBM_CONVERTER_DATA_DIR || process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local"), "KnoxboxMediaConverter", "settings.json");
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

  await saveSettings(modRoot, path.join(testRoot, "mods"));
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
  const playlist = path.join(testRoot, "Disguised Playlist.mp4");
  await fsp.writeFile(playlist, "ffconcat version 1.0\nfile 'Synthetic Movie.mp4'\n");
  await assert.rejects(installMovie(playlist, "Disguised Playlist.mp4", "Playlist", () => undefined), /whitelist|No video stream|Invalid data/i);
  await fsp.rm(playlist, { force: true });

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

  const steamMod = path.join(testRoot, "steamapps", "workshop", "content", "108600", "3823030163", "mods", "KBM_TVVHS");
  await fsp.mkdir(path.join(steamMod, "common/media/lua/client/KBMGB/Movie"), { recursive: true });
  await fsp.writeFile(path.join(steamMod, "common/media/lua/client/KBMGB/Movie/MovieRegistry.lua"), "return {}\n");
  assert(isWorkshopModRoot(steamMod));
  await saveSettings(steamMod, path.join(testRoot, "mods"));
  await assert.rejects(setImportTarget("local"), /separate movie pack/);

  const regenerated = spawnSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=2",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "31", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source,
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(regenerated.status, 0, regenerated.stderr);
  const imagePath = path.join(testRoot, "pack-image.png");
  const generatedImage = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256", "-frames:v", "1", imagePath], { encoding: "utf8", windowsHide: true });
  assert.equal(generatedImage.status, 0, generatedImage.stderr);
  const image = await fsp.readFile(imagePath);
  const malformedImage = Buffer.alloc(24);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(malformedImage);
  malformedImage.writeUInt32BE(256,16);
  malformedImage.writeUInt32BE(256,20);
  await assert.rejects(createPack({ modId: "KBM_BadImage", name: "Bad image", image: malformedImage }), /fully decoded/);
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
  const metadataPath = path.join(pack.root, "42/kbm-movie-pack.json");
  const originalMetadata = await fsp.readFile(metadataPath);
  await fsp.writeFile(metadataPath, originalMetadata.toString().replace("kbm-kbm-testmovies", "invalid-pack-id"));
  await assert.rejects(stagePackForWorkshop(pack.modId), /generated movie pack/);
  await fsp.writeFile(metadataPath, originalMetadata);
  const injectedLua = path.join(pack.root, "42/media/lua/client/Unexpected.lua");
  await fsp.mkdir(path.dirname(injectedLua), { recursive: true });
  await fsp.writeFile(injectedLua, "error('unexpected script')\n");
  await assert.rejects(stagePackForWorkshop(pack.modId), /unexpected folder|unexpected file/);
  await fsp.rm(injectedLua);
  await fsp.rmdir(path.dirname(injectedLua));
  const registerPath = path.join(pack.root, "42/media/lua/shared/KBM_TestMovies_Movies/Register.lua");
  const originalRegister = await fsp.readFile(registerPath);
  await fsp.rm(registerPath);
  try {
    await fsp.symlink(source, registerPath, "file");
    await assert.rejects(stagePackForWorkshop(pack.modId), /link/);
    await fsp.rm(registerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
  } finally { await fsp.writeFile(registerPath, originalRegister); }
  await fsp.writeFile(registerPath, "error('modified generated script')\n");
  const staged = await stagePackForWorkshop(pack.modId);
  assert.equal(staged.root, path.join(testRoot, "Workshop", pack.modId));
  assert.equal(staged.previewFromTemplate, false);
  assert(fs.existsSync(path.join(staged.root, "preview.png")));
  assert(fs.existsSync(path.join(staged.root, "Contents/mods", pack.modId, "42/media/video/KBM_TestMovies_Movies", `${packEntry.id}.mp4`)));
  const stagedRegister = await fsp.readFile(path.join(staged.root, "Contents/mods", pack.modId, "42/media/lua/shared/KBM_TestMovies_Movies/Register.lua"), "utf8");
  assert(!stagedRegister.includes("modified generated script"));
  const workshopTxt = path.join(staged.root, "workshop.txt");
  assert((await fsp.readFile(workshopTxt, "utf8")).includes("visibility=private"));
  await fsp.appendFile(workshopTxt, "id=123456789\n");
  await removeMovie(packEntry.id);
  await stagePackForWorkshop(pack.modId);
  assert((await fsp.readFile(workshopTxt, "utf8")).includes("id=123456789"));
  assert(!fs.existsSync(path.join(staged.root, "Contents/mods", pack.modId, "42/media/video/KBM_TestMovies_Movies", `${packEntry.id}.mp4`)));
  assert(fs.existsSync(path.join(pack.root, "42/mod.info")));
  await saveSettings(modRoot, path.join(testRoot, "mods"));
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
