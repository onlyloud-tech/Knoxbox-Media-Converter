# KnoxBox Movie Importer

![KnoxBox Movie Importer](client/public/logo.gif)

Turn your own videos into VHS tapes for **KnoxBox Television and VHS** on Project Zomboid Build 42. The importer converts videos on your computer, lets you edit their tape titles, and installs them into a personal library or a separate movie-pack mod. Nothing is uploaded by the app.

## What you need

- Project Zomboid Build 42 with **KnoxBox Media Framework** (`KBM_Core`) and **KnoxBox Television and VHS** (`KBM_TVVHS`) installed. The importer needs the `KBM_TVVHS` mod folder even when you are creating a separate movie pack.
- Windows and a working FFmpeg executable. The Windows release package includes FFmpeg; a source checkout does not.
- Enough free disk space for the original video during conversion and the converted video and audio afterward.

**Using a packaged release:** Download the Windows release ZIP from the [GitHub Releases page](https://github.com/onlyloud-tech/KnoxBox-Movie-Importer/releases), extract it, and run `KnoxBox-Movie-Importer-<version>.exe`. The portable executable includes the app runtime and FFmpeg, so you do not need to install Node.js or rebuild the source. Keep the included `THIRD-PARTY-NOTICES.txt` with the executable. Check that the app shows **FFmpeg ready** before importing.

**Building from source:** Install [Node.js with npm](https://nodejs.org/en/download), then follow the [source build instructions](#build-from-source) below. The checked-in Vite 7 dependency requires Node.js 20.19+ or 22.12+.

## Import your first movie

1. Close Project Zomboid. The importer blocks imports while the game is running so it can change mod files safely.
2. Launch the importer and set the **TV/VHS mod folder** to your installed `KBM_TVVHS` folder, commonly `C:\Users\<you>\Zomboid\mods\KBM_TVVHS`. Set the **Zomboid mods folder** to its parent `mods` folder, then save the paths.
3. Choose **Personal local library** to add tapes to your own `KBM_TVVHS` installation, or create/select a **Movie-pack mod** to keep a collection in its own mod.
4. Drop in one or more MP4, MKV, MOV, AVI, WebM, M4V, or OGV videos. Edit the suggested tape titles if you like, then click **Import** and wait for each job to complete. Large selections are sent to the local encoder in groups of 10; you can queue more than 50 videos at once.
5. Start Project Zomboid again. If you created a movie pack, enable that generated mod alongside `KBM_TVVHS` and `KBM_Core`.

Movie-pack mods are created under the selected `Zomboid\mods` folder. They declare a dependency on `KBM_TVVHS` and contain the converted media and tape definitions, without another Java jar. You can optionally give a pack a **256×256 PNG** image under **1 MB**; the importer uses it as the in-game poster and writes a `preview.png` copy for Workshop preparation. The importer does not publish packs automatically.

Each imported movie has a **320×180 H.264 Constrained Baseline video** and, when the source has audio, **one mono 32 kHz Vorbis `audio.ogg` file**. Audio is not split into segments.

## Build from source

These commands are for PowerShell on Windows. Install [Git](https://git-scm.com/download/win) to clone the repository, or download GitHub's source ZIP and open the extracted folder instead:

```powershell
git clone https://github.com/onlyloud-tech/KnoxBox-Movie-Importer.git
Set-Location KnoxBox-Movie-Importer
npm.cmd ci
npm.cmd run check
npm.cmd run build
```

The source repository does not contain FFmpeg. Obtain a Windows FFmpeg build from the links on the [FFmpeg download page](https://ffmpeg.org/download.html) with the `libx264` and `libvorbis` encoders, then put its executable at `vendor\ffmpeg\ffmpeg.exe`. The importer looks there when run from this checkout. To run the built web app locally:

```powershell
npm.cmd run start
```

Open `http://127.0.0.1:48721` in your browser. You can also run `npm.cmd run dev` during development; the same local FFmpeg path is needed for conversions.

To make the portable Windows executable with the included `build\icon.ico`, run:

```powershell
npm.cmd run package:win
```

The configured output is `dist\KnoxBox-Movie-Importer-0.3.1.exe` for this version. Packaging embeds the Electron runtime and copies `vendor\ffmpeg` into the app resources, so users of a correctly packaged executable do not need Node.js or a separate FFmpeg installation. Distribute it in a ZIP with the matching third-party notices and FFmpeg source information.

For the integration test, set the FFmpeg path explicitly:

```powershell
$env:KBM_FFMPEG = (Resolve-Path .\vendor\ffmpeg\ffmpeg.exe).Path
npm.cmd run test:integration
```

## Sharing a build or movie pack

Only distribute movies, audio, subtitles, and artwork you have permission to share. The bundled Gyan FFmpeg binary is GPLv3; a release containing it needs the applicable notices and corresponding source. See [FFmpeg's license guidance](https://ffmpeg.org/legal.html) and the [build provider](https://www.gyan.dev/ffmpeg/builds/). The source repository excludes FFmpeg, installed dependencies, generated builds, and local test data.
