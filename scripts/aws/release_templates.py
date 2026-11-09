"""Reproducible CloudFormation templates. Parameters contain identifiers, never values of secrets."""
import json
from pathlib import Path
from urllib.parse import urlsplit
from release_config import load_release_config


def ref(name): return {"Ref": name}
def att(name, key): return {"Fn::GetAtt": [name, key]}
def sub(value): return {"Fn::Sub": value}


def resource(kind, properties, why, retain=False):
    result = {"Type": kind, "Properties": properties,
        "Metadata": {"com.aws.cloudformation.Context": {"why": why,
            "must": ["Dedicated Lolixco release candidate only", "No credentials in templates or artifacts"]}}}
    if retain:
        result.update(DeletionPolicy="Retain", UpdateReplacePolicy="Retain")
    return result


def policy(statements): return {"Version": "2012-10-17", "Statement": statements}
def allow(actions, resources): return {"Effect": "Allow", "Action": actions, "Resource": resources}


def role(service, statements):
    return resource("AWS::IAM::Role", {"AssumeRolePolicyDocument": policy([{
        "Effect": "Allow", "Principal": {"Service": service}, "Action": "sts:AssumeRole"}]),
        "Policies": [{"PolicyName": "ReleaseResourcesOnly", "PolicyDocument": policy(statements)}]},
        "Run only this release component with resource-scoped permissions")


def bucket(why, versioned=False, temporary=False):
    props = {"PublicAccessBlockConfiguration": {k: True for k in (
        "BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")},
        "OwnershipControls": {"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]},
        "BucketEncryption": {"ServerSideEncryptionConfiguration": [{"ServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}}
    if versioned:
        props["VersioningConfiguration"] = {"Status": "Enabled"}
    if temporary:
        props["LifecycleConfiguration"] = {"Rules": [{"Id": "ExpiryBackup", "Status": "Enabled", "ExpirationInDays": 1,
            "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1}}]}
        props["CorsConfiguration"] = {"CorsRules": [{"AllowedOrigins": ref("AllowedOrigins"),
            "AllowedMethods": ["POST", "GET", "HEAD"], "AllowedHeaders": ["*"], "MaxAge": 60}]}
    return resource("AWS::S3::Bucket", props, why, retain=True)


def foundation():
    config = load_release_config()
    hostname = urlsplit(config['public_origin']).hostname
    r = {}
    for name, args in {"Site": ("Published frontend and 30 authorized edits", True, False),
                       "Private": ("Private ephemeral uploads and reports; deliberately unversioned to avoid retained deleted media", False, True),
                       "Artifacts": ("Explicitly packaged deployment source; no local environment or owner data", True, False)}.items():
        r[name] = bucket(*args)
        r[name + "TLS"] = resource("AWS::S3::BucketPolicy", {"Bucket": ref(name), "PolicyDocument": policy([{
            "Effect": "Deny", "Principal": "*", "Action": "s3:*", "Resource": [att(name, "Arn"), sub("${" + name + ".Arn}/*")],
            "Condition": {"Bool": {"aws:SecureTransport": "false"}}}])}, "Deny unencrypted bucket access")
    r["Jobs"] = resource("AWS::DynamoDB::Table", {"BillingMode": "PAY_PER_REQUEST", "AttributeDefinitions": [{"AttributeName": "pk", "AttributeType": "S"}],
        "KeySchema": [{"AttributeName": "pk", "KeyType": "HASH"}], "SSESpecification": {"SSEEnabled": True},
        "TimeToLiveSpecification": {"AttributeName": "ttl", "Enabled": True},
        "OnDemandThroughput": {"MaxReadRequestUnits": 20, "MaxWriteRequestUnits": 20}}, "Durable owner-bound jobs, expiry and admission counters", True)
    r["DLQ"] = resource("AWS::SQS::Queue", {"SqsManagedSseEnabled": True, "MessageRetentionPeriod": 86400}, "Failed worker dispatch visibility")
    r["Queue"] = resource("AWS::SQS::Queue", {"SqsManagedSseEnabled": True, "VisibilityTimeout": 3600,
        "MessageRetentionPeriod": 3600, "RedrivePolicy": {"deadLetterTargetArn": att("DLQ", "Arn"), "maxReceiveCount": 1}}, "Durable bounded analysis dispatch; no automatic repeated inference")
    r["Images"] = resource("AWS::ECR::Repository", {"ImageTagMutability": "IMMUTABLE", "ImageScanningConfiguration": {"ScanOnPush": True},
        "EncryptionConfiguration": {"EncryptionType": "AES256"}, "LifecyclePolicy": {"LifecyclePolicyText": json.dumps({"rules": [{"rulePriority": 1, "selection": {
            "tagStatus": "any", "countType": "imageCountMoreThan", "countNumber": 3}, "action": {"type": "expire"}}]})},
        "RepositoryPolicyText": policy([{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"},
            "Action": ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"], "Condition": {"StringLike": {
                "aws:SourceArn": sub("arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:lolixco-rc-*")}}}])}, "Private bounded analyzer images", True)
    r["BuildLog"] = resource("AWS::Logs::LogGroup", {"RetentionInDays": 7}, "Bounded build log retention; never provider credentials")
    r["BuildRole"] = role("codebuild.amazonaws.com", [
        allow(["logs:CreateLogStream", "logs:PutLogEvents"], sub("${BuildLog.Arn}:*")),
        allow(["s3:GetObject", "s3:GetObjectVersion"], sub("${Artifacts.Arn}/*")),
        allow("ecr:GetAuthorizationToken", "*"),
        allow(["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage"], att("Images", "Arn")),
    ])
    buildspec = {"version": "0.2", "phases": {"pre_build": {"commands": [
        'aws ecr get-login-password --region "$AWS_DEFAULT_REGION" | docker login --username AWS --password-stdin "${IMAGE_URI%/*}"']},
        "build": {"commands": ['docker build -f server/production/Dockerfile -t "$IMAGE_URI:$IMAGE_TAG" .',
                                 'docker push "$IMAGE_URI:$IMAGE_TAG"']}}}
    r["Builder"] = resource("AWS::CodeBuild::Project", {"ServiceRole": att("BuildRole", "Arn"),
        "Source": {"Type": "S3", "Location": sub("${Artifacts}/source/worker.zip"), "BuildSpec": json.dumps(buildspec)},
        "Artifacts": {"Type": "NO_ARTIFACTS"}, "TimeoutInMinutes": 25,
        "Environment": {"Type": "LINUX_CONTAINER", "ComputeType": "BUILD_GENERAL1_SMALL", "Image": "aws/codebuild/standard:7.0", "PrivilegedMode": True,
            "EnvironmentVariables": [{"Name": "IMAGE_URI", "Value": att("Images", "RepositoryUri")}, {"Name": "IMAGE_TAG", "Value": "candidate"}]},
        "LogsConfig": {"CloudWatchLogs": {"Status": "ENABLED", "GroupName": ref("BuildLog")}}}, "One-off image build; no permanent container capacity")
    r["OAC"] = resource("AWS::CloudFront::OriginAccessControl", {"OriginAccessControlConfig": {
        "Name": sub("${AWS::StackName}-oac"), "OriginAccessControlOriginType": "s3", "SigningBehavior": "always", "SigningProtocol": "sigv4"}}, "Private origin; public delivery only through this CDN")
    code = Path("config/cloudfront-public-routes.js").read_text()
    code = code.replace("if(/^\\/(assets|brand)\\//", "if(/^\\/(assets|brand|media)\\//")
    code = code.replace(" var routes=", " if(uri==='/robots.txt' && request.headers.host.value!==" + json.dumps(hostname) + ")return {statusCode:200,headers:{'content-type':{value:'text/plain'},'x-robots-tag':{value:'noindex, nofollow'},'cache-control':{value:'no-store'}},body:'User-agent: *\\nDisallow: /\\n'};\n var routes=")
    r["Routes"] = resource("AWS::CloudFront::Function", {"Name": sub("${AWS::StackName}-routes"), "AutoPublish": True,
        "FunctionConfig": {"Comment": "Release document routing; private queries noindex; preserve APIs", "Runtime": "cloudfront-js-2.0"}, "FunctionCode": code}, "No blanket API/S3 errors rewritten to HTML")
    indexing = Path('config/cloudfront-indexing.js').read_text().replace('PUBLIC_INDEXING', json.dumps(config['public_indexing'])).replace('PUBLIC_HOST', json.dumps(hostname))
    r['Indexing'] = resource('AWS::CloudFront::Function', {'Name': sub('${AWS::StackName}-indexing'), 'AutoPublish': True,
        'FunctionConfig': {'Comment': 'Index only the approved production hostname and public pages', 'Runtime': 'cloudfront-js-2.0'}, 'FunctionCode': indexing},
        'Host-specific noindex survives shared cached HTML; private URLs and preview always excluded')
    r["Headers"] = resource("AWS::CloudFront::ResponseHeadersPolicy", {"ResponseHeadersPolicyConfig": {
        "Name": sub("${AWS::StackName}-headers"), "CustomHeadersConfig": {"Items": [
            *([] if config['public_indexing'] else [{"Header": "X-Robots-Tag", "Value": "noindex, nofollow", "Override": True}]),
            {"Header": "Permissions-Policy", "Value": "camera=(), microphone=(), geolocation=()", "Override": True}]},
        "SecurityHeadersConfig": {"ContentTypeOptions": {"Override": True}, "FrameOptions": {"FrameOption": "DENY", "Override": True},
            "StrictTransportSecurity": {"AccessControlMaxAgeSec": 31536000, "Override": True},
            "ReferrerPolicy": {"ReferrerPolicy": "strict-origin-when-cross-origin", "Override": True},
            "ContentSecurityPolicy": {"ContentSecurityPolicy": "default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.ytimg.com; font-src 'self'; media-src 'self' blob:; connect-src 'self' https://*.amazonaws.com https://www.youtube.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests", "Override": True}}}}, "HTTPS preview security and noindex, independent of final domain")
    static = {"TargetOriginId": "site", "ViewerProtocolPolicy": "redirect-to-https", "Compress": True,
        "AllowedMethods": ["GET", "HEAD", "OPTIONS"], "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6", "ResponseHeadersPolicyId": ref("Headers"),
        "FunctionAssociations": [{"EventType": "viewer-request", "FunctionARN": att("Routes", "FunctionARN")},
                                 {"EventType": "viewer-response", "FunctionARN": att("Indexing", "FunctionARN")}]}
    api_behavior = {"PathPattern": "/api/*", "TargetOriginId": "api", "ViewerProtocolPolicy": "https-only", "Compress": True,
        "AllowedMethods": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"], "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
        "OriginRequestPolicyId": "b689b0a8-53d0-40ab-baf2-68738e2966ac", "ResponseHeadersPolicyId": ref("Headers")}
    r["CDN"] = resource("AWS::CloudFront::Distribution", {"DistributionConfig": {"Enabled": True, "Comment": "Lolixco public beta; custom hostname prepared; indexing explicitly gated",
        "Aliases": [hostname],
        "HttpVersion": "http2and3", "DefaultRootObject": "index.html", "PriceClass": "PriceClass_All",
        "WebACLId": {"Fn::If": ["HasWaf", ref("WafArn"), ref("AWS::NoValue")]},
        "Origins": [{"Id": "site", "DomainName": att("Site", "RegionalDomainName"), "OriginAccessControlId": ref("OAC"), "S3OriginConfig": {"OriginAccessIdentity": ""}},
            {"Fn::If": ["HasApi", {"Id": "api", "DomainName": ref("ApiDomain"), "CustomOriginConfig": {"OriginProtocolPolicy": "https-only", "OriginSSLProtocols": ["TLSv1.2"]}}, ref("AWS::NoValue")]}],
        "DefaultCacheBehavior": static, "CacheBehaviors": {"Fn::If": ["HasApi", [api_behavior], ref("AWS::NoValue")]},
        "ViewerCertificate": {"AcmCertificateArn": config['certificate_arn'], "SslSupportMethod": "sni-only", "MinimumProtocolVersion": "TLSv1.2_2021"}}},
        "Existing distribution gains validated custom hostname; preserve origins, OAC, WAF and API behavior")
    r["SiteTLS"]["Properties"]["PolicyDocument"]["Statement"].append({"Effect": "Allow", "Principal": {"Service": "cloudfront.amazonaws.com"},
        "Action": "s3:GetObject", "Resource": sub("${Site.Arn}/*"), "Condition": {"StringEquals": {"AWS:SourceArn": sub("arn:aws:cloudfront::${AWS::AccountId}:distribution/${CDN}")}}})
    outputs = {k: {"Value": v} for k, v in {"SiteBucket": ref("Site"), "PrivateBucket": ref("Private"), "ArtifactBucket": ref("Artifacts"),
        "Table": ref("Jobs"), "TableArn": att("Jobs", "Arn"), "QueueUrl": ref("Queue"), "QueueArn": att("Queue", "Arn"),
        "ImageUri": att("Images", "RepositoryUri"), "ImageArn": att("Images", "Arn"), "BuildProject": ref("Builder"),
        "DistributionId": ref("CDN"), "Domain": att("CDN", "DomainName")}.items()}
    return {"AWSTemplateFormatVersion": "2010-09-09", "Description": "Lolixco release candidate: private origins, published media, durable jobs and one-off image builds. Generated with AWS guidance.",
        "Metadata": {"AWS::CloudFormation::Interface": {}, "GeneratedBy": "Lolixco release engineering", "AWSToolsMetrics": {"AWSAgentToolkit": "aws-cloudformation@3"}},
        "Parameters": {"ApiDomain": {"Type": "String", "Default": ""}, "AllowedOrigins": {"Type": "CommaDelimitedList", "Default": ','.join(config['allowed_origins'])},
                       "WafArn": {"Type": "String", "Default": ""}},
        "Conditions": {"HasApi": {"Fn::Not": [{"Fn::Equals": [ref("ApiDomain"), ""]}]}, "HasWaf": {"Fn::Not": [{"Fn::Equals": [ref("WafArn"), ""]}]}},
        "Resources": r, "Outputs": outputs}


def runtime(base, image, secret, origin, account):
    config = load_release_config()
    r = {}
    for name in ("ApiLog", "WorkerLog"):
        r[name] = resource("AWS::Logs::LogGroup", {"LogGroupName": "/aws/lambda/lolixco-rc-" + ("api" if name == "ApiLog" else "worker"), "RetentionInDays": 7}, "Only bounded non-sensitive operational logs")
    shared = [allow(["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Scan"], base["TableArn"]),
        allow(["s3:GetObject", "s3:DeleteObject"], f"arn:aws:s3:::{base['PrivateBucket']}/*"),
        allow("s3:PutObject", f"arn:aws:s3:::{base['PrivateBucket']}/uploads/*"),
        allow("s3:ListBucket", f"arn:aws:s3:::{base['PrivateBucket']}")]
    r["ApiRole"] = role("lambda.amazonaws.com", [*shared, allow("sqs:SendMessage", base["QueueArn"]),
        allow("cloudwatch:GetMetricStatistics", "*"),
        allow(["cloudfront:GetDistributionConfig", "cloudfront:UpdateDistribution"], f"arn:aws:cloudfront::{account}:distribution/{base['DistributionId']}"),
        allow(["logs:CreateLogStream", "logs:PutLogEvents"], sub("${ApiLog.Arn}:*"))])
    r["WorkerPermissions"] = resource("AWS::IAM::Policy", {"PolicyName": "LolixcoReleaseWorker", "Roles": ["LolixcoProductionAIBackend"],
        "PolicyDocument": policy([
            allow(["dynamodb:GetItem", "dynamodb:UpdateItem"], base["TableArn"]),
            allow("s3:GetObject", f"arn:aws:s3:::{base['PrivateBucket']}/uploads/*"),
            allow("s3:PutObject", f"arn:aws:s3:::{base['PrivateBucket']}/reports/*"),
            allow(["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], base["QueueArn"]),
            allow(["logs:CreateLogStream", "logs:PutLogEvents"], sub("${WorkerLog.Arn}:*"))])}, "Existing production reader role gains only this release's processing resources")
    environment = {"JOBS_TABLE": base["Table"], "PRIVATE_BUCKET": base["PrivateBucket"], "JOB_QUEUE": base["QueueUrl"],
                   "PUBLIC_ORIGIN": origin, "ALLOWED_ORIGINS": ','.join(config['allowed_origins']),
                   "AI_ENABLED": "true", "DISTRIBUTION_ID": base["DistributionId"]}
    r["Api"] = resource("AWS::Lambda::Function", {"FunctionName": "lolixco-rc-api", "Runtime": "python3.12", "Handler": "api.handler",
        "Role": att("ApiRole", "Arn"), "MemorySize": 256, "Timeout": 30, "Code": {"S3Bucket": base["ArtifactBucket"], "S3Key": base.get("ApiKey", "source/api.zip")},
        "Environment": {"Variables": environment}}, "Lightweight API; direct uploads never pass 100 MiB through Lambda")
    r["Api"]["DependsOn"] = "ApiLog"
    r["Worker"] = resource("AWS::Lambda::Function", {"FunctionName": "lolixco-rc-worker", "PackageType": "Image", "Code": {"ImageUri": image},
        "Role": f"arn:aws:iam::{account}:role/LolixcoProductionAIBackend", "MemorySize": 3008, "Timeout": 600,
        "EphemeralStorage": {"Size": 4096}, "Environment": {"Variables": {**environment,
            "LOLIXCO_PROVIDER_SECRET_ARN": secret, "LOLIXCO_DEPLOYMENT": "production", "LOLIXCO_GEMINI_YOUTUBE": "1"}}},
        "No idle instances; bounded isolated media jobs, maximum two queue consumers")
    r["Worker"]["DependsOn"] = ["WorkerPermissions", "WorkerLog"]
    r["Dispatch"] = resource("AWS::Lambda::EventSourceMapping", {"FunctionName": ref("Worker"), "EventSourceArn": base["QueueArn"],
        "BatchSize": 1, "Enabled": True, "ScalingConfig": {"MaximumConcurrency": 2}, "FunctionResponseTypes": ["ReportBatchItemFailures"]}, "Bound worker concurrency without consuming unrelated reserved capacity")
    r["Http"] = resource("AWS::ApiGatewayV2::Api", {"ProtocolType": "HTTP", "Name": "Lolixco release API"}, "Same-origin HTTPS integration")
    r["Integration"] = resource("AWS::ApiGatewayV2::Integration", {"ApiId": ref("Http"), "IntegrationType": "AWS_PROXY", "IntegrationUri": att("Api", "Arn"), "PayloadFormatVersion": "2.0", "TimeoutInMillis": 10000}, "Bound request duration")
    r["Route"] = resource("AWS::ApiGatewayV2::Route", {"ApiId": ref("Http"), "RouteKey": "$default", "Target": sub("integrations/${Integration}")}, "Explicit route validation inside the API")
    r["Stage"] = resource("AWS::ApiGatewayV2::Stage", {"ApiId": ref("Http"), "StageName": "$default", "AutoDeploy": True,
        "DefaultRouteSettings": {"ThrottlingBurstLimit": 8, "ThrottlingRateLimit": 1}}, "Bound admission traffic including direct API requests")
    r["Invoke"] = resource("AWS::Lambda::Permission", {"Action": "lambda:InvokeFunction", "FunctionName": ref("Api"), "Principal": "apigateway.amazonaws.com", "SourceArn": sub("arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${Http}/*/*")}, "Only this API can invoke the HTTP Lambda")
    r["Sweep"] = resource("AWS::Events::Rule", {"ScheduleExpression": "rate(15 minutes)", "State": "ENABLED", "Targets": [{"Id": "cleanup", "Arn": att("Api", "Arn")}]}, "Delete expired private media and reports; TTL is not an exact deletion mechanism")
    r["SweepInvoke"] = resource("AWS::Lambda::Permission", {"Action": "lambda:InvokeFunction", "FunctionName": ref("Api"), "Principal": "events.amazonaws.com", "SourceArn": att("Sweep", "Arn")}, "Only the dedicated cleanup schedule")
    for kind, metric in (("Api", "Errors"), ("Worker", "Errors")):
        r[kind + "Errors"] = resource("AWS::CloudWatch::Alarm", {"Namespace": "AWS/Lambda", "MetricName": metric, "Statistic": "Sum", "Period": 300,
            "EvaluationPeriods": 1, "Threshold": 1, "ComparisonOperator": "GreaterThanOrEqualToThreshold", "TreatMissingData": "notBreaching",
            "Dimensions": [{"Name": "FunctionName", "Value": ref(kind)}]}, "Console-visible failed invocation alarm")
    return {"AWSTemplateFormatVersion": "2010-09-09", "Description": "Lolixco bounded anonymous AI API and isolated container worker. Generated with AWS guidance.",
        "Metadata": {"GeneratedBy": "Lolixco release engineering", "AWSToolsMetrics": {"AWSAgentToolkit": "aws-cloudformation@3"}}, "Resources": r,
        "Outputs": {"ApiEndpoint": {"Value": att("Http", "ApiEndpoint")}, "ApiFunction": {"Value": ref("Api")}, "WorkerFunction": {"Value": ref("Worker")}}}


def firewall():
    def visibility(name):
        return {"CloudWatchMetricsEnabled": True, "SampledRequestsEnabled": False, "MetricName": name}
    rules = []
    for priority, name, key, limit in ((0, "ClientRate", "IP", 300), (1, "BetaCapacity", "CONSTANT", 1000)):
        statement = {"Limit": limit, "AggregateKeyType": key, "EvaluationWindowSec": 300}
        if key == "CONSTANT":
            statement["ScopeDownStatement"] = {"SizeConstraintStatement": {"FieldToMatch": {"UriPath": {}},
                "ComparisonOperator": "GE", "Size": 0, "TextTransformations": [{"Priority": 0, "Type": "NONE"}]}}
        rules.append({"Name": name, "Priority": priority, "Action": {"Block": {}},
            "Statement": {"RateBasedStatement": statement}, "VisibilityConfig": visibility(name)})
    return {"AWSTemplateFormatVersion": "2010-09-09", "Description": "Dedicated Lolixco CloudFront beta request limits; generated with AWS guidance.",
        "Resources": {"Firewall": resource("AWS::WAFv2::WebACL", {"Name": "lolixco-rc-firewall", "Scope": "CLOUDFRONT",
            "DefaultAction": {"Allow": {}}, "Rules": rules, "VisibilityConfig": visibility("LolixcoRC")},
            "Two inexpensive request limits; no sampled user requests or paid managed bot plans")},
        "Outputs": {"WafArn": {"Value": att("Firewall", "Arn")}}}
