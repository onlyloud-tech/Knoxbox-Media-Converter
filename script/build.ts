import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

async function buildAll() {
  await viteBuild();
  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: { "process.env.NODE_ENV": '"production"' },
    external: ["express", "multer"],
    minify: true,
    logLevel: "info",
  });
}

buildAll().catch((error) => {
  console.error(error);
  process.exit(1);
});
