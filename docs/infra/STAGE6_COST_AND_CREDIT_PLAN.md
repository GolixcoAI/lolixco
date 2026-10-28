# Stage 6 — cost model and credit decision

Pricing retrieved 2026-10-28, USD before tax, discounts and promotional credits.
Account credit balance, plan, eligibility, remaining allowances and deadlines are
unverified. Approximately $120 is owner-reported; $140 is a possibility, not a
confirmed balance. No credit runway is promised. No billing settings were changed.

## Reproducible pilot model

Run `node scripts/stage6-cost-model.mjs`. Committed `STAGE6_COST_MODEL.json` is its
reproducible output. Quantities are assumptions, not measured media sizes: 30
masters at 1 binary GB each; 30 optimized copies at 0.1 GB; 30 posters at 0.00025 GB;
6 GB staging/quarantine/evidence working allowance and 3 GB retained versions.
Total 42.0075 GB-month. Replace estimates with real measurements at Stage 7A.
Traffic assumes 0.1 GB delivered/play, 12 requests/play, 10% request misses, plus
1 GB/200 requests validation traffic monthly. Seeking, retries and autoplay can
exceed those assumptions. Cache hit rate reduces origin requests, not viewer bytes.

Official machine-readable [Mumbai S3 price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-south-1/index.json),
publication 2026-10-15: Standard first tier $0.025/GB-month; PUT/COPY/POST/LIST
$0.005/1000; GET/other $0.0004/1000; Standard-IA $0.0138/GB-month; Glacier Flexible
storage $0.0045/GB-month. Selected source records/SKUs are committed in
`S3_PRICE_EVIDENCE_ap-south-1.json`. No annotation-request SKUs are used.
[N. Virginia price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json)
shows Standard $0.023/GB-month, preserved separately. Region choice also affects
latency/residency; viewer geography determines CDN transfer pricing.

For conservative PAYG sensitivity, charge all viewer GB at India's published
first paid band $0.109/GB and HTTPS at $0.012/10000. Include 1000 monthly storage
write/list requests, 10% origin GET misses and all retained bytes. Do not deduct
credits or free usage in these gross figures. Actual tier boundaries/free usage
must be reconciled against all account traffic. The model refuses higher traffic
outside its quoted band. [CloudFront PAYG pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/).

| Monthly playback scenario | Viewer GB incl. validation | Storage | CDN bytes | CDN requests | Origin GET | S3 write/list | Gross monthly USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Low: 100 | 11 | 1.050188 | 1.199000 | 0.001680 | 0.000056 | 0.005000 | 2.255924 |
| Moderate: 1000 | 101 | 1.050188 | 11.009000 | 0.014640 | 0.000488 | 0.005000 | 12.079316 |
| Higher: 10000 | 1001 | 1.050188 | 109.109000 | 0.144240 | 0.004808 | 0.005000 | 110.313235 |

These are uncapped planning sensitivities, not a bill quote. PAYG currently advertises
account-shared 1 TB monthly transfer and 10 million HTTP(S) requests free; this
can substantially reduce actual CDN charges if available. Origin fetch transfer
from S3 to CloudFront is not separately charged; S3 requests still matter. U.S.
first paid transfer band is $0.085/GB, so do not apply India's rate globally.
Use account and geography evidence before deducting allowances. Invalidation:
first 1000 paths/month free, then $0.005/path; versioned replacements avoid routine
invalidations. Wildcard invalidation is a path charge, not a per-file charge.
[CloudFront PAYG pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/).

## Pricing model options

Published flat-rate per-distribution prices are Free $0, Pro $15, Business $200,
Premium $1000/month. Included S3 storage respectively 5 GB, 50 GB, 1 TB, 5 TB;
confirm eligible storage-credit scope before applying it to this bucket.
[CloudFront plan pricing](https://aws.amazon.com/cloudfront/pricing/).

Flat-rate Free allowance: 100 GB and 1M requests; Pro: 50 TB and 10M requests.
Plans require an associated WAF ACL; logging/custom-cache features differ by tier.
Real-time access logs and continuous-deployment/staging distributions are among
unsupported features. No overage fees are advertised, but sustained excessive
usage may lead to delivery adjustments; this is not unlimited guaranteed throughput.
Eligibility depends partly on usage history. The low scenario can fit Free's traffic
allowance; moderate/higher need a different allowance or PAYG evaluation. The custom
cache configuration in our reference bundle must be checked for plan compatibility.
No subscription or upgrade is authorized. Choose only after feature, account,
credit, video-workload and service-term confirmation.
[Plan details](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html).

The [CloudFront FAQ](https://aws.amazon.com/cloudfront/faqs/) (retrieved 2026-10-28)
says flat-rate plans cannot be combined with other offers/promotions/discounts.
Do not assume promotional credits pay a flat-rate subscription; ask AWS billing
to confirm this account's terms. Plans auto-renew; cancellation takes effect next
billing cycle and associated resources return to PAYG rather than disappearing.

## Costs outside the base model

One-time local preparation: owner labor, encoding time/electricity and local backups;
no paid transcoding/EC2/MediaConvert assumed. Initial uploads, verification requests
and promotion copies are request charges; upload data transfer into S3 is ordinarily
free. Multipart requests and retries multiply count. File replacement stores another
full version, plus copy/write requests; retained-version allowance must be updated.

A full 30-item seed assuming one master upload, one encoded staging upload, one
poster staging upload and two promotion copies per item has 150 PUT/COPY requests.
At the retrieved request rate that is $0.000750 in one-time requests, excluding
multipart/retries/verification and storage time. This is a future full-target
illustration, not the 1–2-file pilot scope or permission to archive masters.

No automatic IA/Glacier transition proposed for this small pilot. Storage savings
must exceed request/transition, retrieval, minimum-duration, minimum-object and
restore-copy charges. Delivery objects stay Standard. Deep Archive's current storage
rate was not extracted as an archival storage SKU (staging-storage prices must not
be substituted); price it explicitly if selected. [S3 pricing](https://aws.amazon.com/s3/pricing/).

Optional encrypted access logs, CloudTrail data events, CloudWatch request metrics,
alarms, WAF rules/requests, log ingestion/storage/query, KMS keys/requests, DNS,
custom domains, Origin Shield and edge functions are excluded from numerical totals.
Recommend restricted/encrypted logging with short retention plus CloudTrail data
events and useful traffic metrics for a real pilot, subject to an additional quote
and owner approval. Existing CloudTrail event history alone is not object-access
logging. Do not silently enable paid observability. Keep logs out of delivery prefixes.

Optional logging model: monthly incremental cost = ingested GB × ingestion rate
+ retained log GB-month × storage rate + log PUT/GET requests × request rates
+ query GB scanned × query rate + enabled metrics/alarms/data events/WAF charges.
Start a worksheet with 1 GB/month log volume and seven-day retention; get current
regional unit prices and actual distribution plan inclusions before enabling it.
These unselected service rates are deliberately unpriced, not treated as free.

For sensitivity, change `missFraction` to 1 for origin GET stress, requests/play for
scrubbing/retries, and delivered bytes for bots/viral growth. Additional request
cost follows count × unit rate; transfer can dominate. HTTPS egress is not bounded
by a frontend flag. Add exact WAF/telemetry rates before treating the totals as an
all-in pilot budget. Taxes, FX and noncovered charges may be payable outside credits.

## Cost control decision

Propose an owner-approved $5 incremental pilot planning envelope, 1–2 files,
short scheduled test window and named shutdown owner; this is a proposal, not an
authorized spend or enforceable cap. Owner must reprice logging/security choices,
confirm available allowances/credit coverage and approve the revised amount first.
Suggested billing alerts at $1/$3/$5 actual and forecast, with account-wide monitoring
and tags Project/Owner/Stage/ExpiresOn. Check Bills and CDN bytes/request metrics
during/after tests. Billing data and alerts lag; AWS Budgets is not instantaneous
spend enforcement. [Budgets behavior](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).

Use WAF request-rate controls for a separately priced PAYG pilot (or included plan
protections where suitable), bounded test distribution, and fast disabling/revocation.
Shield Standard baseline protection does not prevent all billable L7 traffic.
Do not subscribe to Shield Advanced for this pilot. Removing catalog entries alone
cannot stop third-party URL access. No budgets, alarms or security services are
created now. Cleanup steps are in the rollback runbook.

## EC2 credit exercise — owner checklist only

Official sources retrieved 2026-10-28:
[Earn additional credits](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans-activities.html),
[Free Tier plans](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html),
[Free Tier FAQ](https://aws.amazon.com/free/free-tier-faqs/),
[EC2 eligibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html),
[EC2 rates](https://aws.amazon.com/ec2/pricing/on-demand/),
[EBS rates](https://aws.amazon.com/ebs/pricing/),
[IPv4 rates](https://aws.amazon.com/vpc/pricing/).

1. Owner signs into the intended account's Console Home → Explore AWS → Earn
   additional credits → Launch an instance using Amazon EC2. Confirm the actual
   activity is offered, exact award, completion deadline and required actions.
   Save private evidence. The official program lists an EC2 activity and warns of
   service charges, but does not prove this account receives $20. Do not assume
   an API-only launch satisfies all account-specific console steps.
2. Check Billing → Credits and Free Tier, account opening date, account plan,
   remaining credit, expiry and eligible services. New/legacy eligibility differs.
   New Free plan ends at six months or credit exhaustion, whichever comes first;
   Paid plans can bill beyond credits. Verify credited-service exclusions and
   expiry terms. Do not create/join an Organization or Control Tower for this.
3. Separately authorize the exact exercise, account, region, instance/AMI, budget
   and time window. No launch is authorized by this checklist. Compare Mumbai
   against permitted alternatives; pick the activity-eligible minimal Linux AMI
   without Marketplace fees. A 'Free Tier eligible' badge is not proof of zero
   incremental cost. Exact instance-hour and regional gp3 EBS rates remain a
   preflight decision: dynamic pricing pages were read, but no instance/volume
   configuration was selected, so no unverified rate is quoted.
4. Price compute duration × hourly rate, EBS GB-month prorated lifetime, excess
   IOPS/throughput, snapshots, transfer and any monitoring. Public IPv4 is currently
   $0.005/address-hour, both in-use and idle; applicable allowances/credits must be
   confirmed. Avoid public IPv4 if the activity permits; do not add NAT gateways,
   load balancers or endpoints just for this exercise. Stopped compute can still
   incur EBS/IPv4 charges. For T-family instances consider surplus CPU-credit costs.
5. Before any separately approved launch: record preexisting resources, select
   a minimal root disk with delete-on-termination, encryption and IMDSv2, no user
   data/secrets or unnecessary IAM role. No inbound access unless required; avoid
   SSH open to the world. Choose monitoring and networking deliberately. Follow
   the exact activity instructions for any connection requirement; do not extend
   lifetime on speculation that a reward will arrive.
6. Verify instance/activity state and save instance ID, region, launch time and
   status evidence. Check Explore AWS for completion. Do not pursue other credit
   activities automatically or keep an instance running while waiting on credits.
7. Terminate (not merely stop) the exercise instance within the approved window.
   Confirm terminated state; check only exercise-created EBS volumes, snapshots,
   Elastic IPs and security groups/key pairs; remove residual billable resources
   within specifically authorized cleanup scope. Preserve preexisting resources.
8. Recheck Credits/Explore AWS/Bills later for the actual reward and service costs.
   Confirm award, expiry and net effect privately. If no reward, use billing support;
   do not repeatedly launch instances. No additional credit or zero spend is promised.
