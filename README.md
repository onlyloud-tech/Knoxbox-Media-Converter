# Knoxbox Media Converter

![Knoxbox Media Converter](client/public/logo.gif)

Turn your own videos into VHS tapes for **KnoxBox Television and VHS** on Project Zomboid Build 42. Knoxbox Media Converter processes videos on your computer, lets you edit their tape titles, and installs them into a personal library or a separate movie-pack mod. Nothing is uploaded by the app.

## What you need

- Project Zomboid Build 42 with **KnoxBox Media Framework** (`KBM_Core`) and **KnoxBox Television and VHS** (`KBM_TVVHS`) installed, either locally or through Steam Workshop. The converter needs to find the `KBM_TVVHS` folder even when you create a separate movie pack.
- Windows and a working FFmpeg executable. The Windows release package includes FFmpeg; a source checkout does not.
- Enough free disk space for the original video during conversion and the converted video and audio afterward.

**Using a packaged release:** Download the Windows release ZIP from the [GitHub Releases page](https://github.com/onlyloud-tech/Knoxbox-Media-Converter/releases), extract it, and run `Knoxbox-Media-Converter-<version>.exe`. The portable executable includes the app runtime and FFmpeg, so you do not need to install Node.js or rebuild the source. Keep the included `LICENSE`, `THIRD-PARTY-NOTICES.md`, and FFmpeg license with the executable. Check that the app shows **FFmpeg ready** before converting.

**First launch on Windows:** Windows Defender SmartScreen may show a **"Windows protected your PC"** warning because the executable is not code-signed. This is expected for this release. Choose **More info** and then **Run anyway** to launch it.

**Building from source:** Install [Node.js with npm](https://nodejs.org/en/download), then follow the [source build instructions](#build-from-source) below. The checked-in Vite 7 dependency requires Node.js 20.19+ or 22.12+.

## Import your first movie

1. Close Project Zomboid. The converter blocks imports while the game is running so it can change mod files safely.
2. Launch Knoxbox Media Converter. It looks for a local `Zomboid\mods\KBM_TVVHS` installation first, then for the subscribed Steam Workshop item. If needed, set **TV/VHS mod folder** to the folder containing `KBM_TVVHS\42\mod.info`, for example `C:\Program Files (x86)\Steam\steamapps\workshop\content\108600\3823030163\mods\KBM_TVVHS`. Keep **Project Zomboid mods folder** set to `C:\Users\<you>\Zomboid\mods`, then save the paths.
3. If Movies & TV came from Steam Workshop, create a **Movie-pack mod** for your personal tapes. The converter stores it in `Zomboid\mods`, where Steam updates cannot replace it. **Personal local library** is available only when `KBM_TVVHS` is installed locally.
4. Drop in one or more MP4, MKV, MOV, AVI, WebM, M4V, or OGV videos. Edit the suggested tape titles if you like, then click **Import** and wait for each job to complete. Large selections are sent to the local encoder in groups of 10; you can queue more than 50 videos at once.
5. Start Project Zomboid again. If you created a movie pack, enable that generated mod alongside `KBM_TVVHS` and `KBM_Core`.

Movie-pack mods are created under the selected `Zomboid\mods` folder. They declare a dependency on `KBM_TVVHS` and contain the converted media and tape definitions, without another Java jar. You can optionally give a pack a **256×256 PNG** image under **1 MB**; the converter uses it as the in-game poster and writes a `preview.png` copy for Workshop preparation. The converter does not publish packs automatically.

Each imported movie has a **320×180 H.264 Constrained Baseline video** and, when the source has audio, **one mono 32 kHz Vorbis `audio.ogg` file**. Audio is not split into segments.

## Prepare a movie pack for Steam Workshop

1. Finish importing movies into a movie pack and test the pack in game. Close Project Zomboid before staging it.
2. Select that pack in the converter and click **Stage pack for Workshop**. The converter copies the generated mod to `Zomboid\Workshop\<ModID>\Contents\mods\<ModID>\42` and creates `workshop.txt` and `preview.png` at the Workshop item's root. Your working copy under `Zomboid\mods` stays in place.
3. If you did not choose pack artwork, the first stage uses Project Zomboid's template preview as a placeholder. Replace `preview.png` with your own image before publishing. The new Workshop item starts with `visibility=private` so you can inspect it first.
4. Launch Project Zomboid through Steam, open **Workshop → Create and Update Items**, select the staged item, and upload it. On the Steam Workshop page, add **KnoxBox Television and VHS** as a required item; the pack's `mod.info` already declares `require=KBM_TVVHS` for the game.

After changing the working pack, click **Stage pack for Workshop** again, then update the same Workshop item in game. Restaging refreshes the generated mod files while keeping the existing `workshop.txt` and its Workshop ID. The converter prepares the folder but never uploads it to Steam.

## Build from source

These commands are for PowerShell on Windows. Install [Git](https://git-scm.com/download/win) to clone the repository, or download GitHub's source ZIP and open the extracted folder instead:

```powershell
git clone https://github.com/onlyloud-tech/Knoxbox-Media-Converter.git
Set-Location Knoxbox-Media-Converter
npm.cmd ci
npm.cmd run check
npm.cmd run build
```

The source repository does not contain FFmpeg. Obtain a Windows FFmpeg build from the links on the [FFmpeg download page](https://ffmpeg.org/download.html) with the `libx264` and `libvorbis` encoders, then put its executable at `vendor\ffmpeg\ffmpeg.exe`. The converter looks there when run from this checkout. To run the built web app locally:

```powershell
npm.cmd run start
```

Open `http://127.0.0.1:48721` in your browser. You can also run `npm.cmd run dev` during development; the same local FFmpeg path is needed for conversions.

To make the portable Windows executable, run:

```powershell
npm.cmd run package:win
```

The configured output is `dist\Knoxbox-Media-Converter-0.3.5.exe` for this version. Packaging embeds the Electron runtime, FFmpeg, this license, and third-party notices, so users of a correctly packaged executable do not need Node.js or a separate FFmpeg installation. Official release ZIPs also include the license texts and FFmpeg source information.

For the integration test, set the FFmpeg path explicitly:

```powershell
$env:KBM_FFMPEG = (Resolve-Path .\vendor\ffmpeg\ffmpeg.exe).Path
npm.cmd run test:integration
```

## Sharing a build or movie pack

The original Converter code and assets are covered by the [Knoxbox Media Converter License](LICENSE). You may run and privately modify the tool, but redistributing the application, its source, or modified builds requires Grymlock's prior written permission. You may publish movie packs generated by the tool, subject to the rights in the media and artwork you supply. FFmpeg and other third-party components retain their own licenses.

Only distribute movies, audio, subtitles, and artwork you have permission to share, otherwise you may be subject to copyright. The bundled Gyan FFmpeg binary is GPLv3; a release containing it needs the applicable notices and corresponding source. See [FFmpeg's license guidance](https://ffmpeg.org/legal.html) and the [build provider](https://www.gyan.dev/ffmpeg/builds/). The source repository excludes FFmpeg, installed dependencies, generated builds, and local test data.
