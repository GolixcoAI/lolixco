// Local, dependency-free review checker. No AWS SDK, shell, credentials or network.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
export const templateDir = fileURLToPath(
  new URL("../docs/infra/templates/", import.meta.url),
);
export const loadBundle = () =>
  Object.fromEntries(
    readdirSync(templateDir)
      .filter((x) => x.endsWith(".json"))
      .map((x) => [
        x,
        JSON.parse(readFileSync(resolve(templateDir, x), "utf8")),
      ]),
  );
const arr = (x) => (Array.isArray(x) ? x : [x]);
const equal = (a, b) => assert.deepEqual(a, b);
const wildcard = (p, s) =>
  new RegExp(
    "^" +
      p
        .split("*")
        .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
  ).test(s);
// Deliberately small policy evaluator: only operators used in these examples.
// Unsupported syntax throws. This is NOT the AWS policy engine.
export function decision(
  policy,
  { action, resource, principal = "*", context = {} },
) {
  let allowed = false;
  for (const s of policy.Statement) {
    if (s.NotAction || s.NotResource || s.NotPrincipal)
      throw Error("Unsupported negated element");
    if (
      !arr(s.Action).some((a) =>
        wildcard(a.toLowerCase(), action.toLowerCase()),
      ) ||
      !arr(s.Resource).some((r) => wildcard(r, resource))
    )
      continue;
    if (
      s.Principal &&
      s.Principal !== "*" &&
      !arr(s.Principal.Service ?? s.Principal.AWS).includes(principal)
    )
      continue;
    let matches = true;
    for (const [op, conditions] of Object.entries(s.Condition ?? {})) {
      for (const [key, values] of Object.entries(conditions)) {
        const v = context[key];
        const valuesArray = arr(values);
        if (op === "StringEquals" || op === "Bool")
          matches &&= valuesArray.includes(v);
        else if (op === "StringLike")
          matches &&=
            v !== undefined && valuesArray.some((p) => wildcard(p, v));
        else if (op === "StringNotEquals" || op === "ArnNotEquals")
          matches &&= !valuesArray.includes(v);
        else throw Error("Unsupported condition " + op);
      }
    }
    if (!matches) continue;
    if (s.Effect === "Deny") return "explicitDeny";
    if (s.Effect === "Allow") allowed = true;
    else throw Error("Unsupported Effect");
  }
  return allowed ? "allow" : "implicitDeny";
}
export function assertReleaseReady(bundle) {
  assert(
    !JSON.stringify(bundle).includes("${"),
    "Unresolved placeholders; release blocked",
  );
  // Stage 6 has no deployment mode, including after substitution.
  assert(
    bundle["review-plan.json"].cloudMutationsAllowed,
    "Stage 6 review-only; separate owner authorization and reviewed deployment tooling required",
  );
  throw Error("No deployment implementation is shipped in Stage 6");
}
export function validateBundle(b) {
  const plan = b["review-plan.json"];
  equal(plan.verifierRole, "arn:aws:iam::${ACCOUNT_ID}:role/lolixco-verifier");
  equal(plan.promotionRole, "arn:aws:iam::${ACCOUNT_ID}:role/lolixco-promoter");
  equal(
    [
      plan.format,
      plan.deployable,
      plan.ownerApprovalRequired,
      plan.cloudMutationsAllowed,
    ],
    ["lolixco-stage6-review-only-v1", false, true, false],
  );
  equal(plan.mediaBucket, "${MEDIA_BUCKET}");
  equal(plan.protectedBucketPattern, "golixco-registration-media-*");
  equal(plan.privatePrefixes, [
    "masters/",
    "staging/",
    "quarantine/",
    "audit/",
  ]);
  equal(plan.deliveryPrefixes, ["optimized/", "posters/"]);
  const bucket = "arn:aws:s3:::${MEDIA_BUCKET}",
    delivery = plan.deliveryPrefixes.map((p) => bucket + "/" + p + "*"),
    priv = plan.privatePrefixes.map((p) => bucket + "/" + p + "*");
  const distribution =
    "arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${DISTRIBUTION_ID}";
  equal(plan.distributionArn, distribution);
  const policy = b["bucket-policy.json"];
  equal(policy.Version, "2012-10-17");
  assert.equal(policy.Statement.length, 5);
  const s = (id) => {
    const rows = policy.Statement.filter((x) => x.Sid === id);
    assert.equal(rows.length, 1);
    return rows[0];
  };
  const allow = s("DeliveryOnly");
  equal(allow, {
    Sid: "DeliveryOnly",
    Effect: "Allow",
    Action: "s3:GetObject",
    Resource: delivery,
    Principal: { Service: "cloudfront.amazonaws.com" },
    Condition: { StringEquals: { "AWS:SourceArn": distribution } },
  });
  equal(
    policy.Statement.filter((x) => x.Effect === "Allow"),
    [allow],
  );
  equal(s("DenyPrivateReadsExceptVerification"), {
    Sid: "DenyPrivateReadsExceptVerification",
    Effect: "Deny",
    Action: ["s3:GetObject", "s3:GetObjectVersion"],
    Resource: priv,
    Principal: "*",
    Condition: {
      ArnNotEquals: {
        "aws:PrincipalArn": [plan.verifierRole, plan.promotionRole],
      },
    },
  });
  equal(s("DenyCloudFrontOutsideDelivery"), {
    Sid: "DenyCloudFrontOutsideDelivery",
    Effect: "Deny",
    Action: ["s3:GetObject", "s3:GetObjectVersion"],
    Resource: bucket + "/*",
    Principal: { Service: "cloudfront.amazonaws.com" },
    Condition: { StringNotEquals: { "AWS:SourceArn": distribution } },
  });
  equal(s("DenyDeliveryWritesExceptPromoter"), {
    Sid: "DenyDeliveryWritesExceptPromoter",
    Effect: "Deny",
    Action: ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"],
    Resource: delivery,
    Principal: "*",
    Condition: { ArnNotEquals: { "aws:PrincipalArn": plan.promotionRole } },
  });
  equal(s("DenyInsecureTransport"), {
    Sid: "DenyInsecureTransport",
    Effect: "Deny",
    Action: "s3:*",
    Resource: [bucket, bucket + "/*"],
    Principal: "*",
    Condition: {
      Bool: {
        "aws:SecureTransport": "false",
        "aws:PrincipalIsAWSService": "false",
      },
    },
  });
  const settings = b["bucket-settings.json"];
  equal(settings.Bucket, plan.mediaBucket);
  equal(settings.Region, "ap-south-1");
  equal(settings.PublicAccessBlockConfiguration, {
    BlockPublicAcls: true,
    IgnorePublicAcls: true,
    BlockPublicPolicy: true,
    RestrictPublicBuckets: true,
  });
  equal(settings.OwnershipControls, {
    Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
  });
  equal(settings.ServerSideEncryptionConfiguration, {
    Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
  });
  equal(settings.VersioningConfiguration, { Status: "Enabled" });
  equal(settings.LifecycleConfiguration, {
    Rules: [
      {
        ID: "AbortIncompleteUploads",
        Status: "Enabled",
        Filter: { Prefix: "" },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
      },
    ],
  });
  const oac = b["oac.json"].OriginAccessControlConfig;
  equal(
    [
      oac.SigningProtocol,
      oac.SigningBehavior,
      oac.OriginAccessControlOriginType,
    ],
    ["sigv4", "always", "s3"],
  );
  const d = b["distribution.json"].DistributionConfig;
  equal(d.Enabled, false);
  equal(d.Origins.Quantity, 1);
  equal(d.Origins.Items, [
    {
      Id: "lolixco-s3",
      DomainName: "${MEDIA_BUCKET}.s3.ap-south-1.amazonaws.com",
      OriginPath: "",
      S3OriginConfig: { OriginAccessIdentity: "" },
      OriginAccessControlId: "${OAC_ID}",
    },
  ]);
  const c = d.DefaultCacheBehavior;
  equal(c.TargetOriginId, "lolixco-s3");
  equal(c.ViewerProtocolPolicy, "https-only");
  equal(c.AllowedMethods, {
    Quantity: 2,
    Items: ["GET", "HEAD"],
    CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] },
  });
  equal(c.Compress, false);
  equal(c.CachePolicyId, "${CACHE_POLICY_ID}");
  equal(c.ResponseHeadersPolicyId, "${RESPONSE_HEADERS_POLICY_ID}");
  equal(d.CustomErrorResponses, {
    Quantity: 2,
    Items: [
      { ErrorCode: 403, ErrorCachingMinTTL: 1 },
      { ErrorCode: 404, ErrorCachingMinTTL: 1 },
    ],
  });
  const cp = b["cache-policy.json"].CachePolicyConfig;
  equal([cp.MinTTL, cp.DefaultTTL, cp.MaxTTL], [0, 86400, 31536000]);
  equal(cp.ParametersInCacheKeyAndForwardedToOrigin, {
    EnableAcceptEncodingGzip: false,
    EnableAcceptEncodingBrotli: false,
    HeadersConfig: { HeaderBehavior: "none" },
    CookiesConfig: { CookieBehavior: "none" },
    QueryStringsConfig: { QueryStringBehavior: "none" },
  });
  const headers = b["response-headers-policy.json"].ResponseHeadersPolicyConfig;
  equal(headers.CorsConfig, {
    AccessControlAllowCredentials: false,
    AccessControlAllowHeaders: { Quantity: 1, Items: ["Range"] },
    AccessControlAllowMethods: { Quantity: 2, Items: ["GET", "HEAD"] },
    AccessControlAllowOrigins: { Quantity: 1, Items: ["https://${APP_HOST}"] },
    AccessControlExposeHeaders: {
      Quantity: 4,
      Items: ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
    },
    OriginOverride: true,
  });
  equal(headers.SecurityHeadersConfig, {
    ContentTypeOptions: { Override: true },
    StrictTransportSecurity: {
      AccessControlMaxAgeSec: 31536000,
      IncludeSubdomains: false,
      Preload: false,
      Override: true,
    },
  });
  const staging = b["staging-policy.json"].Statement;
  equal(staging, [
    {
      Sid: "ListStaging",
      Effect: "Allow",
      Action: "s3:ListBucket",
      Resource: bucket,
      Condition: { StringLike: { "s3:prefix": ["staging/*"] } },
    },
    {
      Sid: "UploadStaging",
      Effect: "Allow",
      Action: [
        "s3:PutObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
      ],
      Resource: bucket + "/staging/*",
    },
    {
      Sid: "DenyAnyDeliveryWrite",
      Effect: "Deny",
      Action: ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"],
      Resource: delivery,
    },
  ]);
  const promotion = b["promotion-policy.json"].Statement;
  equal(promotion, [
    {
      Sid: "ReadVerifiedStaging",
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:GetObjectVersion"],
      Resource: bucket + "/staging/*",
    },
    {
      Sid: "CopyApprovedArtifacts",
      Effect: "Allow",
      Action: "s3:PutObject",
      Resource: delivery,
      Condition: {
        StringLike: { "s3:x-amz-copy-source": "${MEDIA_BUCKET}/staging/*" },
      },
    },
    {
      Sid: "RevokeDelivery",
      Effect: "Allow",
      Action: "s3:DeleteObject",
      Resource: delivery,
    },
    {
      Sid: "InvalidateReviewedPaths",
      Effect: "Allow",
      Action: ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
      Resource: distribution,
    },
  ]);
  equal(
    b["audit-policy.json"].Statement.flatMap((x) => arr(x.Action)),
    [
      "s3:ListAllMyBuckets",
      "cloudfront:ListDistributions",
      "ec2:DescribeRegions",
      "ec2:DescribeInstances",
      "sts:GetCallerIdentity",
    ],
  );
  equal(b["verifier-policy.json"].Statement, [
    {
      Sid: "ReadPrivateEvidence",
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:GetObjectVersion"],
      Resource: priv,
    },
  ]);
  for (const [file, p] of Object.entries(b)) {
    if (!file.endsWith("policy.json") || !p.Statement) continue;
    for (const st of p.Statement) {
      assert(!st.NotAction && !st.NotResource && !st.NotPrincipal);
      if (st.Effect === "Allow")
        for (const a of arr(st.Action))
          assert(!a.includes("*"), "Wildcard allow action");
      if (st.Effect === "Allow" && arr(st.Resource).includes("*"))
        assert(file === "audit-policy.json", "Wildcard allow resource");
    }
  }
  const infra = b["infrastructure-maintenance-policy.json"].Statement;
  equal(
    infra.map((x) => x.Resource),
    [
      bucket,
      distribution,
      "arn:aws:cloudfront::${ACCOUNT_ID}:origin-access-control/${OAC_ID}",
    ],
  );
  equal(
    infra.flatMap((x) => x.Action),
    [
      "s3:GetBucketPolicy",
      "s3:PutBucketPolicy",
      "s3:GetBucketPublicAccessBlock",
      "s3:PutBucketPublicAccessBlock",
      "s3:GetBucketOwnershipControls",
      "s3:PutBucketOwnershipControls",
      "s3:GetEncryptionConfiguration",
      "s3:PutEncryptionConfiguration",
      "s3:GetBucketVersioning",
      "s3:PutBucketVersioning",
      "s3:GetLifecycleConfiguration",
      "s3:PutLifecycleConfiguration",
      "s3:GetBucketTagging",
      "s3:PutBucketTagging",
      "cloudfront:GetDistribution",
      "cloudfront:GetDistributionConfig",
      "cloudfront:UpdateDistribution",
      "cloudfront:GetOriginAccessControl",
      "cloudfront:UpdateOriginAccessControl",
    ],
  );
  equal(b["operator-trust.json"], {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: {
          AWS: "arn:aws:iam::${ACCOUNT_ID}:role/lolixco-${TRUSTED_OWNER_ROLE}",
        },
        Action: "sts:AssumeRole",
      },
    ],
  });
  const raw = JSON.stringify(b);
  assert(
    !/AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|aws_secret_access_key|aws_session_token/i.test(
      raw,
    ),
    "Credential material",
  );
  return true;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 2)
      throw Error("Only offline validation is supported");
    validateBundle(loadBundle());
    console.log(
      "Stage 6 review bundle: static checks passed; deployment unavailable.",
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
