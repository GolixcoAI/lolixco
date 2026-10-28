import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  loadBundle,
  validateBundle,
  decision,
  assertReleaseReady,
} from "../scripts/validate-stage6-infra.mjs";
import { estimate, scenarios } from "../scripts/stage6-cost-model.mjs";
const bundle = loadBundle(),
  b = "arn:aws:s3:::${MEDIA_BUCKET}",
  arn = bundle["review-plan.json"].distributionArn;
const context = { "AWS:SourceArn": arn, "aws:SecureTransport": "true" };
const get = (key, extra = {}) => ({
  action: "s3:GetObject",
  resource: b + "/" + key,
  principal: "cloudfront.amazonaws.com",
  context,
  ...extra,
});
test("Stage6: offline reference bundle is valid", () =>
  assert(validateBundle(bundle)));
for (const prefix of ["optimized", "posters"])
  test("Stage6: exact distribution can read " + prefix, () =>
    assert.equal(
      decision(bundle["bucket-policy.json"], get(prefix + "/hash.mp4")),
      "allow",
    ),
  );
for (const prefix of ["masters", "staging", "quarantine", "audit"])
  for (const action of ["s3:GetObject", "s3:GetObjectVersion"])
    test("Stage6: explicit private deny " + prefix + " " + action, () => {
      const policy = structuredClone(bundle["bucket-policy.json"]);
      policy.Statement.push({
        Effect: "Allow",
        Principal: "*",
        Action: "s3:GetObject*",
        Resource: b + "/*",
      });
      assert.equal(
        decision(policy, get(prefix + "/secret", { action })),
        "explicitDeny",
      );
    });
for (const key of [
  "optimized/../masters/x",
  "optimized/%2e%2e/masters/x",
  "/masters/x",
  "Masters/x",
  "staging%2fx",
  "posters2/x",
  "optimized-private/x",
])
  test("Stage6: adversarial key " + key, () => {
    // S3 keys are literal, not filesystem paths. An optimized/ key is deliverable
    // even if its bytes contain traversal text; private-key routing is tested separately.
    const routed = decodeURIComponent(key)
      .replace(/^\//, "")
      .split("/")
      .reduce(
        (parts, p) =>
          p === ".." ? (parts.pop(), parts) : p === "." ? parts : [...parts, p],
        [],
      )
      .join("/");
    assert.notEqual(
      decision(bundle["bucket-policy.json"], get(routed)),
      "allow",
    );
  });
for (const source of [
  "arn:aws:cloudfront::999999999999:distribution/OTHER",
  arn + "evil",
  undefined,
])
  test("Stage6: wrong or missing SourceArn " + source, () =>
    assert.equal(
      decision(
        bundle["bucket-policy.json"],
        get("optimized/x", { context: { "AWS:SourceArn": source } }),
      ),
      "explicitDeny",
    ),
  );
test("Stage6: anonymous direct S3 reads denied", () =>
  assert.equal(
    decision(
      bundle["bucket-policy.json"],
      get("optimized/x", { principal: "anonymous", context: {} }),
    ),
    "implicitDeny",
  ));
test("Stage6: ordinary IAM broad read cannot defeat private deny", () =>
  assert.equal(
    decision(
      bundle["bucket-policy.json"],
      get("audit/x", {
        principal: "arn:aws:iam::123456789012:role/unrelated",
        context: {
          "aws:PrincipalArn": "arn:aws:iam::123456789012:role/unrelated",
        },
      }),
    ),
    "explicitDeny",
  ));
test("Stage6: insecure transport explicitly denied", () =>
  assert.equal(
    decision(
      bundle["bucket-policy.json"],
      get("optimized/x", {
        context: {
          "aws:SecureTransport": "false",
          "aws:PrincipalIsAWSService": "false",
        },
      }),
    ),
    "explicitDeny",
  ));
for (const p of ["optimized", "posters", "masters", "quarantine", "audit"])
  test("Stage6: staging cannot write " + p, () =>
    assert.notEqual(
      decision(bundle["staging-policy.json"], {
        action: "s3:PutObject",
        resource: b + "/" + p + "/x",
      }),
      "allow",
    ),
  );
test("Stage6: staging can upload only to staging", () =>
  assert.equal(
    decision(bundle["staging-policy.json"], {
      action: "s3:PutObject",
      resource: b + "/staging/x",
    }),
    "allow",
  ));
test("Stage6: unrelated bucket cannot be targeted", () => {
  for (const f of [
    "staging-policy.json",
    "promotion-policy.json",
    "infrastructure-maintenance-policy.json",
  ])
    assert.notEqual(
      decision(bundle[f], {
        action: "s3:PutObject",
        resource: "arn:aws:s3:::golixco-registration-media-example/staging/x",
      }),
      "allow",
    );
});
test("Stage6: promoter requires copy source and distinct permission", () => {
  const req = { action: "s3:PutObject", resource: b + "/optimized/hash.mp4" };
  assert.equal(decision(bundle["promotion-policy.json"], req), "implicitDeny");
  assert.equal(
    decision(bundle["promotion-policy.json"], {
      ...req,
      context: { "s3:x-amz-copy-source": "${MEDIA_BUCKET}/staging/hash.mp4" },
    }),
    "allow",
  );
  assert.equal(
    decision(bundle["promotion-policy.json"], {
      ...req,
      context: { "s3:x-amz-copy-source": "unrelated/staging/x" },
    }),
    "implicitDeny",
  );
});
for (const action of [
  "s3:PutObject",
  "ec2:RunInstances",
  "iam:CreateRole",
  "cloudfront:CreateDistribution",
  "s3:DeleteObject",
])
  test("Stage6: audit has no mutation " + action, () =>
    assert.equal(
      decision(bundle["audit-policy.json"], {
        action,
        resource: b + "/staging/x",
      }),
      "implicitDeny",
    ),
  );
const mutations = {
  "public read": (b) => (b["bucket-policy.json"].Statement[0].Principal = "*"),
  "wildcard read": (b) =>
    (b["bucket-policy.json"].Statement[0].Resource = [
      "arn:aws:s3:::${MEDIA_BUCKET}/*",
    ]),
  "wildcard SourceArn": (b) =>
    (b["bucket-policy.json"].Statement[0].Condition = {
      StringLike: { "AWS:SourceArn": "*" },
    }),
  "removed private deny": (b) => b["bucket-policy.json"].Statement.splice(1, 1),
  "ACL enabled": (b) =>
    (b["bucket-settings.json"].OwnershipControls.Rules[0].ObjectOwnership =
      "ObjectWriter"),
  "public access enabled": (b) =>
    (b[
      "bucket-settings.json"
    ].PublicAccessBlockConfiguration.BlockPublicPolicy = false),
  "weak OAC": (b) =>
    (b["oac.json"].OriginAccessControlConfig.SigningBehavior = "never"),
  "website origin": (b) =>
    (b["distribution.json"].DistributionConfig.Origins.Items[0].DomainName =
      "example.s3-website.ap-south-1.amazonaws.com"),
  "HTTP viewer": (b) =>
    (b[
      "distribution.json"
    ].DistributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy =
      "allow-all"),
  "upload from CDN": (b) =>
    b[
      "distribution.json"
    ].DistributionConfig.DefaultCacheBehavior.AllowedMethods.Items.push("PUT"),
  "staging broad write": (b) =>
    (b["staging-policy.json"].Statement[1].Resource = "*"),
  "promotion direct upload": (b) =>
    delete b["promotion-policy.json"].Statement[1].Condition,
  "audit writes": (b) =>
    b["audit-policy.json"].Statement[0].Action.push("s3:PutObject"),
  "infra IAM admin": (b) =>
    b["infrastructure-maintenance-policy.json"].Statement[0].Action.push(
      "iam:CreatePolicy",
    ),
  "wildcard trust": (b) =>
    (b["operator-trust.json"].Statement[0].Principal = "*"),
  "unrelated bucket": (b) =>
    (b["review-plan.json"].mediaBucket = "golixco-registration-media-example"),
  "deployment enabled": (b) =>
    (b["review-plan.json"].cloudMutationsAllowed = true),
  "credential material": (b) =>
    (b["review-plan.json"].aws_session_token = "example-secret"),
  "versioning removed": (b) =>
    (b["bucket-settings.json"].VersioningConfiguration.Status = "Suspended"),
  "cache error success": (b) =>
    (b[
      "distribution.json"
    ].DistributionConfig.CustomErrorResponses.Items[0].ResponseCode = "200"),
  "range headers hidden": (b) =>
    (b[
      "response-headers-policy.json"
    ].ResponseHeadersPolicyConfig.CorsConfig.AccessControlExposeHeaders.Items =
      []),
};
for (const [label, mutate] of Object.entries(mutations))
  test("Stage6: rejects " + label, () => {
    const b = structuredClone(bundle);
    mutate(b);
    assert.throws(() => validateBundle(b));
  });
test("Stage6: placeholder release blocked, substituted review still blocked", () => {
  assert.throws(() => assertReleaseReady(bundle), /placeholders/);
  const b = JSON.parse(
    JSON.stringify(bundle).replace(/\$\{[^}]+\}/g, "example"),
  );
  assert.throws(() => assertReleaseReady(b), /review-only/);
});
test("Stage6: unsupported evaluator syntax fails closed", () =>
  assert.throws(
    () =>
      decision(
        {
          Statement: [
            {
              Effect: "Allow",
              Action: "s3:GetObject",
              Resource: "*",
              Condition: { Invalid: { x: "y" } },
            },
          ],
        },
        get("optimized/x"),
      ),
    /Unsupported/,
  ));
test("Stage6: stored cost scenarios reproducible and scale with traffic", () => {
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        new URL("../docs/infra/STAGE6_COST_MODEL.json", import.meta.url),
      ),
    ).scenarios,
    scenarios(),
  );
  assert(estimate(10000).total > estimate(1000).total);
  assert.throws(() => estimate(-1));
  assert.throws(() => estimate(200000));
  assert(Math.abs(estimate(0).storedGB - 42.0075) < 1e-10);
});
test("Stage6: runbook separates catalog removal and cached delivery revocation", () => {
  const d = readFileSync(
    new URL(
      "../docs/infra/STAGE6_DEPLOYMENT_AND_ROLLBACK_RUNBOOK.md",
      import.meta.url,
    ),
    "utf8",
  );
  for (const word of [
    "publicationRemoval",
    "cached",
    "delete markers",
    "multipart",
    "owner approval",
    "retained versions",
  ])
    assert(d.includes(word), word);
});
test("Stage6: no deploy executable, workflow or credentials introduced", () => {
  const s = readFileSync(
    new URL("../scripts/validate-stage6-infra.mjs", import.meta.url),
    "utf8",
  );
  assert(
    !/child_process|node:https|node:http|@aws-sdk|execSync|fetch\(/.test(s),
  );
  const w = readFileSync(
    new URL("../.github/workflows/frontend-ci.yml", import.meta.url),
    "utf8",
  );
  assert(
    !/aws-actions|configure-aws-credentials|cdk deploy|terraform apply|cloudformation deploy/.test(
      w,
    ),
  );
});
test("Stage6: IAM actions and resource types match official offline reference", () => {
  const evidence = JSON.parse(
    readFileSync(
      new URL("../docs/infra/IAM_ACTION_EVIDENCE.json", import.meta.url),
    ),
  );
  for (const [file, policy] of Object.entries(bundle)) {
    if (!file.endsWith("policy.json") || !policy.Statement) continue;
    for (const statement of policy.Statement)
      for (const action of Array.isArray(statement.Action)
        ? statement.Action
        : [statement.Action]) {
        if (statement.Effect !== "Allow") continue;
        const definition = evidence.actions[action];
        assert(definition, action);
        if (file === "audit-policy.json") {
          assert.equal(definition.Annotations.Properties.IsWrite, false);
          assert(!definition.Annotations.Properties.IsPermissionManagement);
        }
        const resources = Array.isArray(statement.Resource)
          ? statement.Resource
          : [statement.Resource];
        for (const resource of resources) {
          if (resource === "*") {
            assert(!definition.Resources?.length, action);
            continue;
          }
          const type = resource.startsWith("arn:aws:s3:::")
            ? resource.includes("}/")
              ? "object"
              : "bucket"
            : resource.includes(":distribution/")
              ? "distribution"
              : resource.includes(":origin-access-control/")
                ? "origin-access-control"
                : null;
          assert(
            definition.Resources?.some((r) => r.Name === type),
            action + " resource " + resource,
          );
        }
      }
  }
});
