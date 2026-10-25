import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compileCatalog } from "../scripts/compile-catalog.mjs";
import {
  recoverCatalogPair,
  commitCatalogPair,
} from "../scripts/catalog-transaction.mjs";
import { inputs, NOW, ORIGIN } from "./catalog-fixtures.mjs";
import { edits } from "../src/data/edits.ts";
import { rawSpawnSync } from "./isolated-child-process.mjs";
import { compileYouTubeCatalog } from "../scripts/compile-youtube-catalog.mjs";

function fixture() {
  const dir = fs.mkdtempSync(join(tmpdir(), "lolixco-unified-")),
    paths = [join(dir, "edits.ts"), join(dir, "snapshot.json")];
  return {
    dir,
    paths,
    options: inputs(paths),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
async function withFixture(fn) {
  const f = fixture();
  try {
    await fn(f);
  } finally {
    f.cleanup();
  }
}
function ok(result) {
  assert.equal(result.success, true, result.errors?.join("; "));
  return result;
}

test("Unified: deterministic mixed-source output preserves all 17 frozen demos and stable numeric ordering", async () =>
  withFixture(async (f) => {
    const inputBefore = JSON.stringify(f.options);
    const first = ok(await compileCatalog(f.options));
    assert.equal(JSON.stringify(f.options), inputBefore);
    f.options.youtubeAudit.items.reverse();
    f.options.hostedAudit.items.reverse();
    const second = ok(await compileCatalog(f.options));
    assert.equal(first.source, second.source);
    assert.equal(first.snapshot, second.snapshot);
    assert.deepEqual(first.catalog.slice(0, 17), edits);
    assert.deepEqual(
      first.catalog.map((item) => item.id),
      [...Array(17).keys(), 100, 200, 300, 400],
    );
    assert.equal(fs.existsSync(f.paths[0]), false);
    assert.deepEqual(JSON.parse(first.snapshot).edits, first.catalog);
  }));

for (const source of ["youtubeAudit", "hostedAudit"])
  test(`Unified: updating ${source} cannot delete the other source`, async () =>
    withFixture(async (f) => {
      const first = ok(await compileCatalog(f.options));
      const other =
        source === "youtubeAudit" ? "licensed_local_media" : "youtube_embed";
      const before = first.catalog.filter((item) => item.sourceType === other);
      f.options.previousCatalog = first.catalog;
      if (source === "youtubeAudit")
        f.options.youtubeAudit.items[0].metadata.title =
          "Updated editorial title";
      else f.options.hostedAudit.items[0].title = "Updated hosted title";
      assert.deepEqual(
        ok(await compileCatalog(f.options)).catalog.filter(
          (item) => item.sourceType === other,
        ),
        before,
      );
    }));

for (const [name, mutate] of [
  [
    "missing YouTube audit",
    (o) => {
      delete o.youtubeAudit;
    },
  ],
  [
    "missing hosted audit",
    (o) => {
      delete o.hostedAudit;
    },
  ],
  [
    "malformed audit",
    (o) => {
      o.youtubeAudit = { items: null };
    },
  ],
  [
    "duplicate video identity",
    (o) => {
      o.youtubeAudit.items.push(structuredClone(o.youtubeAudit.items[0]));
    },
  ],
  [
    "duplicate allocated ID",
    (o) => {
      o.youtubeAudit.items[1].assignedLolixcoId = 100;
    },
  ],
  [
    "unsafe ID",
    (o) => {
      o.hostedAudit.items[0].assignedLolixcoId = 300.5;
    },
  ],
  [
    "historical conflict",
    (o) => {
      o.youtubeAudit.items[1].auditHistory = [{ assignedLolixcoId: 100 }];
    },
  ],
  [
    "invalid provenance",
    (o) => {
      o.youtubeAudit.items[0].metadata.provenance = "unknown";
    },
  ],
  [
    "synthetic evidence",
    (o) => {
      o.youtubeAudit.items[0].metadata.syntheticOrigin = "offline-synthetic";
    },
  ],
  [
    "unconfirmed short",
    (o) => {
      o.youtubeAudit.items[1].formatConfirmed = false;
    },
  ],
  [
    "missing playback",
    (o) => {
      delete o.youtubeAudit.items[0].playbackVerification;
    },
  ],
  [
    "contradictory YouTube duration",
    (o) => {
      o.youtubeAudit.items[0].metadata.durationFormatted = "9:59";
    },
  ],
  [
    "stale metadata",
    (o) => {
      o.youtubeAudit.items[0].lastMetadataVerification = "2000-01-01T00:00:00Z";
    },
  ],
  [
    "missing video rights",
    (o) => {
      o.hostedAudit.items[0].rights.videoDistribution = false;
    },
  ],
  [
    "missing audio rights",
    (o) => {
      o.hostedAudit.items[0].rights.audioDistribution = false;
    },
  ],
  [
    "uncleared legacy rights flag",
    (o) => {
      o.hostedAudit.items[0].rightsCleared = false;
    },
  ],
  [
    "unverified hosted bytes",
    (o) => {
      o.hostedAudit.items[0].mediaVerification.decodeVerified = false;
    },
  ],
  [
    "candidate origin injection",
    (o) => {
      o.hostedAudit.items[0].approvedOrigins = [ORIGIN];
      o.policy = {};
    },
  ],
  [
    "credential-bearing URL",
    (o) => {
      o.hostedAudit.items[0].deliveryUrl += "?token=private-fixture";
    },
  ],
  [
    "forged demo identity",
    (o) => {
      o.previousCatalog[0].source =
        "https://attacker.invalid/media/motion-study.webm";
    },
  ],
])
  test(`Unified: ${name} fails before mutating either public output`, async () =>
    withFixture(async (f) => {
      ok(await compileCatalog({ ...f.options, publish: true }));
      const before = f.paths.map((path) => fs.readFileSync(path, "utf8"));
      f.options.previousCatalog = JSON.parse(before[1]).edits;
      mutate(f.options);
      const result = await compileCatalog({ ...f.options, publish: true });
      assert.equal(result.success, false);
      assert.doesNotMatch(result.errors.join(";"), /private-fixture/);
      assert.deepEqual(
        f.paths.map((path) => fs.readFileSync(path, "utf8")),
        before,
      );
    }));

test("Unified: public projection strips legitimate private audit fields and cannot leak array credentials", async () =>
  withFixture(async (f) => {
    f.options.youtubeAudit.items[0].curatorNotes = "PRIVATE_REVIEW_NOTES";
    f.options.hostedAudit.items[0].s3MasterArchiveKey = "PRIVATE_MASTER_KEY";
    const result = ok(await compileCatalog(f.options));
    assert.doesNotMatch(
      result.source + result.snapshot,
      /PRIVATE_|documentationRef|mediaVerification|playbackVerification/,
    );
    f.options.hostedAudit.items[0].tags = ["ghp_" + "a".repeat(36)];
    assert.equal((await compileCatalog(f.options)).success, false);
  }));

test("Unified: missing source records cannot erase an existing public item", async () =>
  withFixture(async (f) => {
    const first = ok(await compileCatalog(f.options));
    f.options.previousCatalog = first.catalog;
    f.options.hostedAudit.items = [];
    assert.equal((await compileCatalog(f.options)).success, false);
  }));

for (const status of ["draft", "rejected", "embed_restricted", "unavailable"])
  test(`Unified: ${status} cannot silently remove a public item`, async () =>
    withFixture(async (f) => {
      f.options.previousCatalog = ok(await compileCatalog(f.options)).catalog;
      f.options.youtubeAudit.items[0].contentReviewStatus = status;
      assert.equal((await compileCatalog(f.options)).success, false);
    }));

test("Unified: explicit private removal authorization removes only the matched record and keeps its ID reserved", async () =>
  withFixture(async (f) => {
    f.options.previousCatalog = ok(await compileCatalog(f.options)).catalog;
    const item = f.options.youtubeAudit.items[0];
    item.contentReviewStatus = "rejected";
    item.publicationRemoval = {
      approved: true,
      id: 100,
      identity: item.canonicalVideoId,
      status: "rejected",
      reason: "Owner removed fixture",
      approvedAt: NOW,
    };
    const next = ok(await compileCatalog(f.options));
    assert.equal(next.catalog.length, 20);
    assert.equal(
      next.catalog.some((e) => e.id === 100),
      false,
    );
    f.options.previousCatalog = next.catalog;
    f.options.youtubeAudit.items[1].auditHistory = [{ assignedLolixcoId: 100 }];
    assert.equal((await compileCatalog(f.options)).success, false);
  }));

test("Unified: paired fixture publication generates executable TypeScript matching Python snapshot and check mode", async () =>
  withFixture(async (f) => {
    fs.copyFileSync(
      resolve("src/data/media-assets.js"),
      join(f.dir, "media-assets.js"),
    );
    fs.writeFileSync(join(f.dir, "package.json"), '{"type":"module"}');
    const result = ok(await compileCatalog({ ...f.options, publish: true }));
    delete f.options.previousCatalog;
    assert.equal(
      ok(await compileCatalog({ ...f.options, check: true })).matches,
      true,
    );
    const loaded = await import(pathToFileURL(f.paths[0]).href);
    assert.deepEqual(
      loaded.edits,
      JSON.parse(fs.readFileSync(f.paths[1], "utf8")).edits,
    );
    const python = rawSpawnSync(
      "python3",
      [
        "-c",
        `from server.recsys.catalog import load_catalog_from_json
import sys
c=load_catalog_from_json(sys.argv[1]); assert len(c)==21; assert c.get(100).channel_title=='Fixture creator'; assert c.get(300).channel_title is None; assert c.get(100).source_url=='https://www.youtube.com/watch?v=12345678901'
print('mixed snapshot and runtime loader: passed')`,
        f.paths[1],
      ],
      { cwd: resolve("."), encoding: "utf8" },
    );
    assert.equal(python.status, 0, python.stderr);
    assert.equal(result.written, true);
  }));

test("Unified: second-output rename failure rolls both files back byte-for-byte", async () =>
  withFixture(async (f) => {
    ok(await compileCatalog({ ...f.options, publish: true }));
    const before = f.paths.map((path) => fs.readFileSync(path, "utf8"));
    delete f.options.previousCatalog;
    f.options.youtubeAudit.items[0].metadata.title = "A changed title";
    let renames = 0;
    const result = await compileCatalog({
      ...f.options,
      publish: true,
      io: {
        renameSync(...args) {
          if (++renames === 2) throw new Error("injected write failure");
          return fs.renameSync(...args);
        },
      },
    });
    assert.equal(result.success, false);
    assert.equal(renames, 2);
    assert.match(result.errors.join(";"), /original outputs restored/);
    assert.deepEqual(
      f.paths.map((path) => fs.readFileSync(path, "utf8")),
      before,
    );
    assert.equal(
      fs
        .readdirSync(f.dir)
        .some(
          (name) => name.includes("transaction") || name.includes("staged"),
        ),
      false,
    );
  }));

test("Unified: interrupted process leaves recoverable paired outputs", async () =>
  withFixture(async (f) => {
    fs.writeFileSync(f.paths[0], "old frontend");
    fs.writeFileSync(f.paths[1], "old snapshot");
    const script = join(f.dir, "crash.mjs");
    fs.writeFileSync(
      script,
      `import fs from 'node:fs';import {commitCatalogPair} from ${JSON.stringify(pathToFileURL(resolve("scripts/catalog-transaction.mjs")).href)};let n=0;commitCatalogPair(${JSON.stringify(f.paths)},['new frontend','new snapshot'],{io:{renameSync(...a){fs.renameSync(...a);if(++n===1)process.kill(process.pid,'SIGKILL');}}});`,
    );
    const child = rawSpawnSync(process.execPath, [script], {
      cwd: resolve("."),
      encoding: "utf8",
      env: { ...process.env },
    });
    assert.equal(child.signal, "SIGKILL", child.stderr);
    assert.equal(recoverCatalogPair(f.paths), true);
    assert.equal(fs.readFileSync(f.paths[0], "utf8"), "old frontend");
    assert.equal(fs.readFileSync(f.paths[1], "utf8"), "old snapshot");
    assert.equal(recoverCatalogPair(f.paths), false);
    assert.equal(
      fs.readdirSync(f.dir).some((name) => name.includes(".staged-")),
      false,
    );
  }));

test("Unified: existing paired outputs prevent omitted caller state or incomplete audits from deleting content", async () =>
  withFixture(async (f) => {
    ok(await compileCatalog({ ...f.options, publish: true }));
    const before = f.paths.map((path) => fs.readFileSync(path, "utf8"));
    delete f.options.previousCatalog;
    f.options.hostedAudit.items = [];
    assert.equal(
      (await compileCatalog({ ...f.options, publish: true })).success,
      false,
    );
    assert.deepEqual(
      f.paths.map((path) => fs.readFileSync(path, "utf8")),
      before,
    );
  }));

test("Unified: the demo trust template is byte-for-byte the frozen milestone catalog", () => {
  assert.equal(
    fs.readFileSync("content/baseline/edits.ts", "utf8"),
    fs.readFileSync("src/data/edits.ts", "utf8"),
  );
});

test("Unified: explicit empty audits preserve the exact demo-only frontend and snapshot", async () =>
  withFixture(async (f) => {
    f.options.youtubeAudit.items = [];
    f.options.hostedAudit.items = [];
    delete f.options.policy;
    const result = ok(await compileCatalog(f.options));
    assert.equal(result.source, fs.readFileSync("src/data/edits.ts", "utf8"));
    assert.deepEqual(
      JSON.parse(result.snapshot),
      JSON.parse(
        fs.readFileSync("server/recsys/catalog_snapshot.json", "utf8"),
      ),
    );
  }));

test("Unified: unallocated drafts remain private and rejected historical owners retain IDs", async () =>
  withFixture(async (f) => {
    const rejected = structuredClone(f.options.youtubeAudit.items[0]);
    rejected.contentReviewStatus = "rejected";
    f.options.youtubeAudit.items[0] = rejected;
    const draft = structuredClone(rejected);
    draft.canonicalVideoId = "DraftItem01";
    draft.assignedLolixcoId = null;
    draft.format = null;
    draft.contentReviewStatus = "draft";
    f.options.youtubeAudit.items.push(draft);
    assert.equal(ok(await compileCatalog(f.options)).catalog.length, 20);
    const replacement = structuredClone(rejected);
    replacement.canonicalVideoId = "NewOwner001";
    replacement.contentReviewStatus = "approved";
    f.options.youtubeAudit.items.push(replacement);
    assert.equal((await compileCatalog(f.options)).success, false);
  }));

test("Unified: failed initial pair installation leaves neither output and live writer recovery is refused", async () =>
  withFixture(async (f) => {
    let n = 0;
    assert.throws(
      () =>
        commitCatalogPair(f.paths, ["frontend", "snapshot"], {
          io: {
            renameSync(...args) {
              assert.throws(() => recoverCatalogPair(f.paths), /still running/);
              if (++n === 2) throw new Error("fixture failure");
              fs.renameSync(...args);
            },
          },
        }),
      /original outputs restored/,
    );
    assert.equal(fs.existsSync(f.paths[0]), false);
    assert.equal(fs.existsSync(f.paths[1]), false);
  }));

test("Unified CLI: default is dry-run, publish uses fixture pairs and cannot overwrite audit inputs", async () =>
  withFixture(async (f) => {
    const paths = {
      youtube: join(f.dir, "youtube.json"),
      hosted: join(f.dir, "hosted.json"),
      policy: join(f.dir, "policy.json"),
    };
    const stamp = new Date().toISOString();
    for (const record of [
      ...f.options.youtubeAudit.items,
      ...f.options.hostedAudit.items,
    ]) {
      record.lastMetadataVerification = stamp;
      record.playbackVerification.verifiedAt = stamp;
      if (record.mediaVerification) record.mediaVerification.verifiedAt = stamp;
    }
    fs.writeFileSync(paths.youtube, JSON.stringify(f.options.youtubeAudit));
    fs.writeFileSync(paths.hosted, JSON.stringify(f.options.hostedAudit));
    fs.writeFileSync(paths.policy, JSON.stringify(f.options.policy));
    const args = [
      "scripts/compile-catalog.mjs",
      "--youtube-audit",
      paths.youtube,
      "--hosted-audit",
      paths.hosted,
      "--policy",
      paths.policy,
      "--output",
      f.paths[0],
      "--snapshot",
      f.paths[1],
    ];
    let run = rawSpawnSync(process.execPath, args, {
      cwd: resolve("."),
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.existsSync(f.paths[0]), false);
    run = rawSpawnSync(process.execPath, [...args, "--publish"], {
      cwd: resolve("."),
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(fs.readFileSync(f.paths[1])).total_edits, 21);
    const old = fs.readFileSync(paths.hosted, "utf8");
    const overlapping = args.slice(0, -1).concat(paths.hosted, "--publish");
    run = rawSpawnSync(process.execPath, overlapping, {
      cwd: resolve("."),
      encoding: "utf8",
    });
    assert.equal(run.status, 1);
    assert.equal(fs.readFileSync(paths.hosted, "utf8"), old);
    run = rawSpawnSync(
      process.execPath,
      [
        "scripts/compile-catalog.mjs",
        "--youtube-audit",
        resolve("content/audit/youtube-intake-audit.json"),
        "--hosted-audit",
        paths.hosted,
      ],
      { cwd: resolve("."), encoding: "utf8" },
    );
    assert.equal(run.status, 1);
    assert.doesNotMatch(run.stderr, /api[_-]?key|secret value/i);
  }));

test("Unified: production targets and aliases remain blocked under test isolation; legacy production writer is retired", async () =>
  withFixture(async (f) => {
    const production = resolve("src/data/edits.ts");
    fs.symlinkSync(production, join(f.dir, "alias.ts"));
    assert.equal(
      (
        await compileCatalog({
          ...f.options,
          publish: true,
          outputPath: production,
        })
      ).success,
      false,
    );
    assert.equal(
      (
        await compileCatalog({
          ...f.options,
          publish: true,
          outputPath: join(f.dir, "alias.ts"),
        })
      ).success,
      false,
    );
    for (const dryRun of [false, null, 0, ""]) {
      const legacy = await compileYouTubeCatalog({
        dryRun,
        outputPath: production,
        auditFilePath: join(f.dir, "absent.json"),
      });
      assert.equal(legacy.success, false);
      assert.match(legacy.errors.join(";"), /retired|blocked/i);
    }
    const cli = rawSpawnSync(
      process.execPath,
      ["scripts/compile-youtube-catalog.mjs", "--write"],
      { cwd: resolve("."), encoding: "utf8" },
    );
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /compile-catalog/);
  }));
