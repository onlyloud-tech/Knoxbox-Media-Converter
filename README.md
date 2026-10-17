# KnoxBox Movie Importer

Desktop converter for the KnoxBox television and VHS player in `KBM_TVVHS`.

The importer has two destinations:

- **Personal local library** installs converted movies into the user's own `KBM_TVVHS` folder.
- **Movie-pack mod** creates or updates a separate Project Zomboid Build 42 mod under the user's `Zomboid/mods` folder. Generated packs depend on `KBM_TVVHS`, contain no Java jar, and are ready to enable, test, or prepare for Workshop publication.

When creating a pack, users can select optional 256x256 PNG artwork under 1 MB. The importer validates the dimensions, writes it as `42/poster.png`, references it from `mod.info`, and keeps a root `preview.png` copy for later Workshop packaging.

Generated video uses 320x180 H.264 Constrained Baseline at CRF 28 with B-frames disabled. New imports use one compact mono 32 kHz Vorbis OGG file at quality 0 per movie. Existing packs with 30-second OGG segments remain playable.

## Development

```powershell
npm.cmd run check
npm.cmd run build
```

Run the integration test with `KBM_FFMPEG` set to an FFmpeg executable:

```powershell
$env:KBM_FFMPEG = (Resolve-Path .\vendor\ffmpeg\ffmpeg.exe).Path
npm.cmd run test:integration
```

The source repository excludes installed dependencies, generated builds, test data,
and the local FFmpeg executable. Run `npm ci` after cloning, and provide a compatible
FFmpeg executable at `vendor/ffmpeg/ffmpeg.exe` for local imports and Windows
packaging. If distributing a packaged build with FFmpeg, review and include the
license notices and corresponding-source information required for that exact binary.

The source movie remains local. Only distribute movies, audio, subtitles, and artwork for which you have redistribution rights.
