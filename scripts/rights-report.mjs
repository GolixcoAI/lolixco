/** Local case intake only; no mailbox, network, or automatic takedown integration. */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
export function createRightsCase(report, now = new Date().toISOString()) {
  if (!report || typeof report !== "object" || Array.isArray(report))
    throw Error("Report required");
  for (const field of [
    "contentUrl",
    "contact",
    "claimedRights",
    "supportingInformation",
  ])
    if (typeof report[field] !== "string" || !report[field].trim())
      throw Error(`Missing ${field}`);
  const url = new URL(report.contentUrl);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error("Public content URL required");
  if (!["copyright", "attribution"].includes(report.kind))
    throw Error("Select copyright or attribution");
  return {
    caseVersion: 1,
    caseId: randomUUID(),
    status: "received",
    receivedAt: now,
    report: structuredClone(report),
    events: [
      {
        at: now,
        action: "received",
        note: "Internal intake; no automatic removal or rights determination",
      },
    ],
  };
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.length !== 4)
    throw Error(
      "Usage: rights-report.mjs REPORT.json EXISTING_PRIVATE_DIRECTORY",
    );
  const target = realpathSync(process.argv[3]);
  const repo = realpathSync(new URL("..", import.meta.url));
  const rel = relative(repo, target);
  if (!rel || (!rel.startsWith("..") && !isAbsolute(rel)))
    throw Error("Case evidence must remain outside repository");
  const record = createRightsCase(
    JSON.parse(readFileSync(process.argv[2], "utf8")),
  );
  mkdirSync(target, { recursive: true, mode: 0o700 });
  writeFileSync(
    resolve(target, record.caseId + ".json"),
    JSON.stringify(record, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(`Created private case ${record.caseId}; owner review required`);
}
