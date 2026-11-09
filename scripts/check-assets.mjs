import { statSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { assetPaths } from "../src/data/media-assets.js";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = resolve(directory, entry.name);
    return entry.isDirectory() ? files(name) : [name];
  });
}

export function checkAssets(root = projectRoot, publicDirectory = "public") {
  const paths = new Set(assetPaths);
  // Delivered S3 assets stay out of Git/build bundles. Only exact, integrity-bound
  // entries in the reviewed public manifest may resolve outside the local tree.
  const published = new Set();
  const manifestPath = resolve(root, 'public/media-manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const item of manifest.items) for (const kind of ['video','poster']) {
      const asset = item[kind];
      if (!/^\/media\/hosted\/\d+-[a-f0-9]{16}\.(?:mp4|webp)$/.test(asset.path)
          || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) {
        throw new Error('Invalid published media manifest entry');
      }
      published.add(asset.path.slice(1));
    }
  }
  // Also cover literal public references in styles and components so adding a
  // background image cannot silently bypass the shared metadata manifest.
  for (const file of files(resolve(root, "src"))) {
    if (!/\.(css|tsx?|jsx?)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(
      /["'`](\/(?:media|brand)\/[^"'`\s)]+)["'`]/g,
    )) {
      if (!match[1].includes("${")) paths.add(match[1].slice(1));
    }
  }
  const errors = [];
  const results = [];
  for (const asset of paths) {
    if (published.has(asset)) continue;
    const file = resolve(root, publicDirectory, asset);
    try {
      const info = statSync(file);
      if (!info.isFile() || info.size === 0)
        throw new Error("empty or not a file");
      const data = readFileSync(file);
      const extension = extname(file);
      if (extension === ".svg" && !data.toString("utf8").includes("<svg"))
        throw new Error("invalid SVG header");
      if (
        extension === ".png" &&
        data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      )
        throw new Error("invalid PNG header");
      if (
        extension === ".webm" &&
        data.subarray(0, 4).toString("hex") !== "1a45dfa3"
      )
        throw new Error("invalid WebM header");
      results.push({ path: asset, bytes: info.size });
    } catch (error) {
      errors.push(`${relative(root, file)}: ${error.message}`);
    }
  }
  if (errors.length)
    throw new Error(`Local asset validation failed:\n${errors.join("\n")}`);
  return results;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const results = checkAssets(projectRoot, process.argv[2] || "public");
  console.log(
    `Verified ${results.length} referenced local media/brand assets (${results.reduce((n, item) => n + item.bytes, 0)} bytes).`,
  );
}
