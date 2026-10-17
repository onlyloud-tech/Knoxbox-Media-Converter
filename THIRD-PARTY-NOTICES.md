# Third-party notices for the Windows release

The portable Windows executable includes an unmodified `ffmpeg.exe` from Gyan Doshi's FFmpeg 9.0 full build. FFmpeg and the libraries compiled into that binary are separate third-party software; KnoxBox does not own their copyrights.

- Build provider: https://www.gyan.dev/ffmpeg/builds/
- Build release: https://github.com/GyanD/codexffmpeg/releases/tag/9.0
- FFmpeg revision identified by that release: `d32b387f2b`
- FFmpeg source: https://github.com/FFmpeg/FFmpeg/commit/d32b387f2b
- License: GPLv3; see `COPYING.GPLv3` in the release ZIP and the accompanying `FFmpeg-d32b387f2b-source.zip` asset.

The importer runs FFmpeg as a separate executable to convert local media. The bundled binary reports `--enable-gpl --enable-version3 --enable-static` and includes `libx264` and `libvorbis`. Its exact configuration can be inspected with `ffmpeg.exe -buildconf`. The source repository excludes the FFmpeg binary. If replacing the bundled binary, update this notice and provide the corresponding source and license information for that build.
