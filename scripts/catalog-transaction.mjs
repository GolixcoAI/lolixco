import * as fs from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isTestIsolationActive } from "./youtube-api.mjs";
import {
  isProtectedProductionPath,
  isProtectedAuditPath,
} from "./youtube-importer.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const baselineTemplate = resolve(root, "content/baseline/edits.ts");
export const PRODUCTION_OUTPUTS = Object.freeze([
  resolve(root, "src/data/edits.ts"),
  resolve(root, "server/recsys/catalog_snapshot.json"),
]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function canonicalPath(path) {
  const absolute = resolve(path);
  if (fs.existsSync(absolute)) return fs.realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute
    ? absolute
    : join(canonicalPath(parent), basename(absolute));
}

export function checkOutputPaths(paths) {
  if (
    !Array.isArray(paths) ||
    paths.length !== 2 ||
    paths.some((p) => typeof p !== "string")
  )
    throw new Error("Two output paths are required");
  for (const path of paths) {
    if (resolve(path) === baselineTemplate)
      throw new Error(
        "Immutable demo template cannot be an output destination",
      );
    // Lexical protection is checked before canonical filesystem operations.
    if (isProtectedAuditPath(path))
      throw new Error("Private audit destinations are forbidden");
    if (
      isTestIsolationActive() &&
      (isProtectedProductionPath(path) ||
        resolve(path) === PRODUCTION_OUTPUTS[1])
    )
      throw new Error(
        "Protected production output blocked under test isolation",
      );
  }
  const result = paths.map(canonicalPath);
  if (result.includes(baselineTemplate))
    throw new Error(
      "Immutable demo template alias cannot be an output destination",
    );
  if (
    result[0] === result[1] ||
    !result[0].endsWith(".ts") ||
    !result[1].endsWith(".json")
  )
    throw new Error("Outputs must be distinct TypeScript and JSON files");
  if (
    isTestIsolationActive() &&
    result.some(
      (p) =>
        PRODUCTION_OUTPUTS.includes(p) ||
        isProtectedProductionPath(p) ||
        isProtectedAuditPath(p),
    )
  )
    throw new Error("Protected output alias blocked under test isolation");
  const production = result.some((p) => PRODUCTION_OUTPUTS.includes(p));
  if (production && !result.every((p, i) => p === PRODUCTION_OUTPUTS[i]))
    throw new Error(
      "Production frontend and snapshot must be published together",
    );
  return result;
}

function durableFile(path, bytes, mode = 0o600) {
  const fd = fs.openSync(path, "wx", mode);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fchmodSync(fd, mode);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function syncDir(path) {
  const fd = fs.openSync(path, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function journalPath(paths) {
  return join(
    dirname(paths[0]),
    `.lolixco-catalog-${digest(paths.join("\n")).slice(0, 16)}.transaction`,
  );
}
function restore(journal, paths, manifest) {
  // Copy backups, never consume them: recovery remains retryable after failure.
  const backups = manifest.files.map((item, i) => {
    if (!item.existed) return null;
    const bytes = fs.readFileSync(join(journal, `old-${i}`));
    if (digest(bytes) !== item.sha256)
      throw new Error(
        "Transaction backup integrity failed; retain journal for recovery",
      );
    return bytes;
  });
  for (let i = 0; i < 2; i++) {
    const item = manifest.files[i];
    if (!item.existed) {
      fs.rmSync(paths[i], { force: true });
      continue;
    }
    const bytes = backups[i];
    const temp = join(
      dirname(paths[i]),
      `.${basename(paths[i])}.restore-${process.pid}`,
    );
    fs.rmSync(temp, { force: true });
    durableFile(temp, bytes, item.mode);
    fs.renameSync(temp, paths[i]);
    syncDir(dirname(paths[i]));
  }
}

export function recoverCatalogPair(outputPaths) {
  const paths = checkOutputPaths(outputPaths),
    journal = journalPath(paths);
  if (!fs.existsSync(journal)) return false;
  const manifest = JSON.parse(
    fs.readFileSync(join(journal, "manifest.json"), "utf8"),
  );
  if (
    manifest.version !== 1 ||
    !Number.isSafeInteger(manifest.pid) ||
    manifest.pid <= 0 ||
    JSON.stringify(manifest.paths) !== JSON.stringify(paths) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== 2 ||
    manifest.files.some(
      (item) =>
        !item ||
        typeof item.existed !== "boolean" ||
        !Number.isSafeInteger(item.mode) ||
        item.mode < 0 ||
        item.mode > 0o777 ||
        (item.existed && !/^[a-f0-9]{64}$/.test(item.sha256)),
    )
  )
    throw new Error(
      "Unrecognized transaction journal; manual recovery required",
    );
  try {
    process.kill(manifest.pid, 0);
    throw new Error("Transaction owner is still running; recovery refused");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  if (!fs.existsSync(join(journal, "committed")))
    restore(journal, paths, manifest);
  for (const path of paths)
    fs.rmSync(
      join(dirname(path), `.${basename(path)}.staged-${manifest.pid}`),
      { force: true },
    );
  fs.rmSync(journal, { recursive: true });
  syncDir(dirname(journal));
  return true;
}

export function commitCatalogPair(outputPaths, contents, options = {}) {
  const paths = checkOutputPaths(outputPaths),
    journal = journalPath(paths);
  if (
    options.io &&
    (!isTestIsolationActive() ||
      paths.some((p) => PRODUCTION_OUTPUTS.includes(p)))
  )
    throw new Error(
      "Custom transaction IO is limited to isolated fixture destinations",
    );
  const io = options.io || fs;
  for (const path of paths) fs.mkdirSync(dirname(path), { recursive: true });
  // Exclusive directory is both a writer lock and a durable crash-recovery record.
  try {
    fs.mkdirSync(journal, { mode: 0o700 });
  } catch {
    throw new Error(
      "Catalog transaction already exists; inspect/recover it before retrying",
    );
  }
  let prepared = false;
  const manifest = { version: 1, pid: process.pid, paths, files: [] };
  try {
    for (let i = 0; i < 2; i++) {
      const existed = fs.existsSync(paths[i]);
      const old = existed ? fs.readFileSync(paths[i]) : null;
      const mode = existed ? fs.statSync(paths[i]).mode & 0o777 : 0o644;
      manifest.files.push({ existed, sha256: old ? digest(old) : null, mode });
      if (old) durableFile(join(journal, `old-${i}`), old);
      // Stage on each output's filesystem: rename remains atomic per destination.
      durableFile(
        join(dirname(paths[i]), `.${basename(paths[i])}.staged-${process.pid}`),
        contents[i],
        mode,
      );
    }
    durableFile(join(journal, "manifest.json"), JSON.stringify(manifest));
    syncDir(journal);
    syncDir(dirname(journal));
    prepared = true;
    for (let i = 0; i < 2; i++) {
      io.renameSync(
        join(dirname(paths[i]), `.${basename(paths[i])}.staged-${process.pid}`),
        paths[i],
      );
      syncDir(dirname(paths[i]));
    }
    durableFile(join(journal, "committed"), "complete\n");
    syncDir(journal);
  } catch {
    if (prepared) {
      try {
        restore(journal, paths, manifest);
      } catch {
        throw new Error(
          "Catalog transaction failed; rollback incomplete, retain journal and recover before reuse",
        );
      }
    }
    fs.rmSync(journal, { recursive: true, force: true });
    throw new Error("Catalog transaction failed; original outputs restored");
  } finally {
    for (const path of paths)
      fs.rmSync(
        join(dirname(path), `.${basename(path)}.staged-${process.pid}`),
        { force: true },
      );
  }
  fs.rmSync(journal, { recursive: true });
  syncDir(dirname(journal));
}
