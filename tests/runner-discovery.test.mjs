import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTestFiles } from "../scripts/run-isolated-tests.mjs";
import { rawSpawnSync } from "./isolated-child-process.mjs";

test("Runner discovers sorted regular test files without shell expansion or recursion", () => {
  const dir = mkdtempSync(join(tmpdir(), "lolixco-discovery-"));
  try {
    const names = ["z.test.mjs", "a.test.mjs", "space ; $(literal).test.mjs"];
    for (const name of names) writeFileSync(join(dir, name), "");
    writeFileSync(join(dir, "helper.mjs"), "");
    mkdirSync(join(dir, "directory.test.mjs"));
    writeFileSync(join(dir, "directory.test.mjs", "nested.test.mjs"), "");
    symlinkSync(join(dir, "a.test.mjs"), join(dir, "linked.test.mjs"));

    assert.deepEqual(discoverTestFiles([], dir), names.sort().map((name) => join(dir, name)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Runner preserves explicit selection and arguments literally without scanning defaults", () => {
  const args = ["--test-name-pattern=selected", "test with spaces;$(literal).mjs"];
  const files = discoverTestFiles(args, "/nonexistent-default-directory");
  assert.deepEqual(files, args);
  assert.notEqual(files, args);
});

test("Runner rejects empty default discovery instead of falling back to Node auto-discovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "lolixco-empty-tests-"));
  try {
    writeFileSync(join(dir, "helper.mjs"), "");
    assert.throws(() => discoverTestFiles([], dir), /No test files found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Trusted launcher executes only the explicitly selected file with literal metacharacters", () => {
  const dir = mkdtempSync(join(tmpdir(), "lolixco-selected-tests-"));
  try {
    const selected = join(dir, "selected ; $(literal).test.mjs");
    writeFileSync(selected, `
      import test from "node:test";
      import assert from "node:assert/strict";
      test("explicit isolated selection", () => {
        assert.equal(process.env.LOLIXCO_KERNEL_ISOLATED, "1");
        assert.equal(process.env.YOUTUBE_DATA_API_KEY, undefined);
        assert.equal(process.env.NODE_OPTIONS, undefined);
      });
    `);
    writeFileSync(join(dir, "unselected.test.mjs"), 'throw new Error("unselected file executed");');
    const root = fileURLToPath(new URL("../", import.meta.url));
    const result = rawSpawnSync("/usr/bin/env", [
      "-i", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      `HOME=${dir}`, "/bin/bash", "--noprofile", "--norc",
      resolve(root, "scripts/run-isolated-tests.sh"), selected,
    ], { cwd: root, encoding: "utf8", env: {}, timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /# tests 1\b/);
    assert.match(result.stdout, /# pass 1\b/);
    assert.doesNotMatch(result.stdout, /unselected file executed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
