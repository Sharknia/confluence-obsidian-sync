import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/cli/main.ts"], bundle: true, platform: "node", format: "esm", target: "node22",
  outfile: "dist/cli.mjs", logLevel: "info",
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' }
});
