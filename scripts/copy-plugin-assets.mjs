import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const projectRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const distDirectory = join(projectRoot, "dist");

await mkdir(distDirectory, { recursive: true });

await Promise.all([
  copyFile(join(projectRoot, "manifest.json"), join(distDirectory, "manifest.json")),
  copyFile(join(projectRoot, "styles.css"), join(distDirectory, "styles.css"))
]);
