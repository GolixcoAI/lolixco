"""Publish exactly the 30 owner-authorized prepared pairs; verify every checksum.

The inventory stays local. Only an explicit, path-free public manifest is built.
Owner authorization: Stage 18B deployment instructions, November 2026.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path

import boto3
from boto3.s3.transfer import TransferConfig
from deploy_release import ACCOUNT, REGION, ROOT, client, outputs


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def publish(session, inventory):
    records = json.loads(inventory.read_text())["items"]
    if len(records) != 30 or len({r["draft_identity"] for r in records}) != 30:
        raise ValueError("Expected exactly 30 unique prepared edits")
    base = outputs(session)
    s3 = client(session, "s3")
    manifest, catalog = [], []
    config = TransferConfig(multipart_threshold=128 * 1024 * 1024, max_concurrency=2)
    manifest_path = ROOT / "public/media-manifest.json"
    previous = {x["originalSha256"]: x for x in json.loads(manifest_path.read_text())["items"]} if manifest_path.exists() else {}
    used = set()
    for index, record in enumerate(records):
        original = record["draft_identity"].removeprefix("sha256:")
        prior = previous.get(original, {})
        start = 400 if record["recommended_format"] == "short" else 300
        candidate = prior.get("id", -1)
        identity = candidate if start <= candidate < start + 100 and candidate not in used else next(n for n in range(start, start + 100) if n not in used)
        used.add(identity)
        item = {"id": identity, "originalSha256": record["draft_identity"].removeprefix("sha256:"),
                "title": record["title"], "description": record["description"], "hashtags": record["hashtags"]}
        for kind, content_type, extension in (("video", "video/mp4", "mp4"), ("poster", "image/webp", "webp")):
            asset = record["recommended_" + kind]
            path = Path(asset["path"])
            digest = sha256(path)
            if digest != asset["sha256"] or path.stat().st_size != asset["size_bytes"]:
                raise ValueError("Prepared asset integrity mismatch")
            key = f"media/hosted/{identity}-{digest[:16]}.{extension}"
            # Preserve existing content-addressed URLs when assigning a corrected
            # public ID partition; the object's name does not define its format.
            if prior.get(kind, {}).get("sha256") == digest:
                key = prior[kind]["path"].removeprefix("/")
                if not key.startswith("media/hosted/") or ".." in key:
                    raise ValueError("Unexpected prior public object path")
            expected = base64.b64encode(bytes.fromhex(digest)).decode()
            try:
                current = s3.head_object(Bucket=base["SiteBucket"], Key=key, ChecksumMode="ENABLED")
            except s3.exceptions.ClientError as error:
                if error.response["Error"]["Code"] not in {"404", "NoSuchKey"}:
                    raise
                current = None
            if not current or current.get("ChecksumSHA256") != expected:
                s3.upload_file(str(path), base["SiteBucket"], key, Config=config, ExtraArgs={
                    "ContentType": content_type, "CacheControl": "public,max-age=31536000,immutable",
                    "ServerSideEncryption": "AES256", "ChecksumAlgorithm": "SHA256",
                    "ChecksumSHA256": expected, "Metadata": {"sha256": digest}})
                current = s3.head_object(Bucket=base["SiteBucket"], Key=key, ChecksumMode="ENABLED")
            if current.get("ChecksumSHA256") != expected or current["ContentLength"] != path.stat().st_size:
                raise ValueError("AWS checksum verification failed")
            item[kind] = {"path": "/" + key, "sha256": digest, "bytes": path.stat().st_size,
                          "preparedSha256": asset.get("derived_from_sha256", digest)}
        seconds = round(record["duration_seconds"])
        edit = {"id": identity, "title": record["title"], "description": record["description"],
                "category": record["category_approved_target"],
                "tags": sorted(set(record["search_tags"] + [h.lstrip("#").lower() for h in record["hashtags"]])),
                "hashtags": record["hashtags"], "creator": record["creator_credit"] or "Attribution pending",
                "poster": "https://" + base["Domain"] + item["poster"]["path"], "source": "https://" + base["Domain"] + item["video"]["path"],
                "duration": f"{seconds // 60}:{seconds % 60:02}", "trending": False,
                "format": record["recommended_format"], "fandomIds": record["fandom_ids"],
                "sourceType": "licensed_local_media"}
        item.update({"format": edit["format"], "durationSeconds": record["duration_seconds"],
                     "width": record["recommended_video"]["media"]["width"],
                     "height": record["recommended_video"]["media"]["height"]})
        catalog.append(edit)
        manifest.append(item)
        print(json.dumps({"id": identity, "video": "checksum verified", "poster": "checksum verified"}), flush=True)
    destination = ROOT / "src/data/hosted-catalog.ts"
    destination.write_text('import type {Edit} from "./edits";\nexport const hostedCatalog: (Edit & {hashtags: string[]})[] = ' + json.dumps(catalog, ensure_ascii=False, indent=2) + ';\n')
    (ROOT / "public/media-manifest.json").write_text(json.dumps({"version": 1, "authorization": "Owner authorized Stage 18B public release candidate", "items": manifest}, ensure_ascii=False, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory", type=Path)
    parser.add_argument("--profile", default="lolixco-codex")
    args = parser.parse_args()
    session = boto3.Session(profile_name=args.profile, region_name=REGION)
    if client(session, "sts").get_caller_identity()["Account"] != ACCOUNT:
        raise RuntimeError("Unexpected AWS account")
    publish(session, args.inventory)


if __name__ == "__main__":
    main()
