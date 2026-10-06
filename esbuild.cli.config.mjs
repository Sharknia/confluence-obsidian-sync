import esbuild from "esbuild";
import { chmod, writeFile } from "node:fs/promises";

const result = await esbuild.build({
  entryPoints: ["src/cli/main.ts"], bundle: true, platform: "node", format: "esm", target: "node22",
  outfile: "dist/cli.mjs", logLevel: "info", metafile: true,
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' }
});

await chmod("dist/cli.mjs", 0o755);
await writeFile("dist/cli-metafile.json", JSON.stringify(result.metafile));
