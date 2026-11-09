"""Publish only a scanned Vite dist directory to the dedicated release origin."""
import hashlib
import json
import mimetypes
import subprocess

import boto3
from deploy_release import ACCOUNT, REGION, ROOT, client, outputs
from release_config import load_release_config


def main():
    release = load_release_config()
    built_indexing = 'Allow: /' in (ROOT / 'dist/robots.txt').read_text()
    if built_indexing != release['public_indexing']:
        raise RuntimeError('Build indexing mode must match config/aws-release.json')
    subprocess.run(["node", "scripts/check-release-build.mjs", "dist"], cwd=ROOT, check=True)
    s = boto3.Session(profile_name="lolixco-codex", region_name=REGION)
    if client(s, "sts").get_caller_identity()["Account"] != ACCOUNT:
        raise RuntimeError("Unexpected AWS account")
    base = outputs(s)
    s3 = client(s, "s3")
    count = 0
    for path in sorted((ROOT / "dist").rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        key = str(path.relative_to(ROOT / "dist"))
        if key.startswith("media/hosted/") or ".env" in key or key.endswith(".map"):
            raise RuntimeError("Unexpected deployment artifact")
        data = path.read_bytes()
        mime = mimetypes.guess_type(key)[0] or "application/octet-stream"
        if key.endswith(".js"):
            mime = "application/javascript"
        immutable = key.startswith(("assets/", "brand/"))
        s3.put_object(Bucket=base["SiteBucket"], Key=key, Body=data, ContentType=mime,
            ServerSideEncryption="AES256", Metadata={"sha256": hashlib.sha256(data).hexdigest()},
            CacheControl="public,max-age=31536000,immutable" if immutable else "public,max-age=60,must-revalidate")
        count += 1
    client(s, "cloudfront").create_invalidation(DistributionId=base["DistributionId"],
        InvalidationBatch={"Paths": {"Quantity": 1, "Items": ["/*"]}, "CallerReference": hashlib.sha256((ROOT / "dist/index.html").read_bytes()).hexdigest()})
    print(json.dumps({"published_files": count, "url": release['public_origin'], "preview": 'https://' + base['Domain'], "indexing": built_indexing}))


if __name__ == "__main__":
    main()
