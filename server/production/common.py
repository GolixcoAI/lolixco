"""Private AWS job storage and bounded anonymous beta admission."""
import hashlib
import json
import logging
import os
import re
import time
from decimal import Decimal

import boto3
from botocore.config import Config

for name in ("boto3", "botocore", "urllib3"):
    logging.getLogger(name).setLevel(logging.CRITICAL)
CONFIG = Config(connect_timeout=3, read_timeout=8, retries={"mode": "standard", "total_max_attempts": 2},
                ignore_configured_endpoint_urls=True)
SESSION = boto3.Session()
TABLE = SESSION.resource("dynamodb", config=CONFIG).Table(os.environ["JOBS_TABLE"])
# Pin regional routing: a newly created bucket's global endpoint can redirect a
# signed browser POST, losing the upload body or failing preflight.
S3 = SESSION.client("s3", region_name=SESSION.region_name,
    endpoint_url=f"https://s3.{SESSION.region_name}.amazonaws.com",
    config=CONFIG.merge(Config(signature_version="s3v4")))
SQS = SESSION.client("sqs", config=CONFIG)
BUCKET = os.environ["PRIVATE_BUCKET"]
QUEUE = os.environ["JOB_QUEUE"]
MAX_BYTES = 100 * 1024 * 1024
MEDIA_ID = re.compile(r"[a-f0-9]{32}")
JOB_ID = re.compile(r"job_\d+_[a-f0-9]{24}")
VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
TERMINAL = {"COMPLETE", "FAILED", "CANCELLED"}


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def json_default(value):
    if isinstance(value, Decimal):
        return int(value) if value == int(value) else float(value)
    raise TypeError("Unsupported result type")


def get(pk):
    return TABLE.get_item(Key={"pk": pk}, ConsistentRead=True).get("Item")


def put(item, condition=None):
    item = json.loads(json.dumps(item, default=json_default), parse_float=Decimal)
    TABLE.put_item(Item=item, **({"ConditionExpression": condition} if condition else {}))


def counter(key, limit, seconds=86400):
    now = int(time.time())
    window = now // seconds
    try:
        TABLE.update_item(Key={"pk": f"CAP#{key}#{window}"},
            UpdateExpression="SET #n = if_not_exists(#n, :zero) + :one, #ttl = :ttl",
            ConditionExpression="attribute_not_exists(#n) OR #n < :limit",
            ExpressionAttributeNames={"#n": "count", "#ttl": "ttl"},
            ExpressionAttributeValues={":zero": 0, ":one": 1, ":limit": limit, ":ttl": now + seconds * 2})
    except TABLE.meta.client.exceptions.ConditionalCheckFailedException:
        return False
    return True


def owned(kind, identity, owner):
    row = get(kind + "#" + identity)
    if not row or row.get("owner") != owner:
        raise RequestError(404, "This private item is unavailable.")
    if row["expires"] <= int(time.time()):
        raise RequestError(410, "This private item has expired.")
    return row


class RequestError(Exception):
    def __init__(self, status, message, code=None):
        self.status, self.message, self.code = status, message, code


def remove_prefix(prefix):
    for page in S3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=prefix):
        keys = [{"Key": item["Key"]} for item in page.get("Contents", [])]
        if keys:
            S3.delete_objects(Bucket=BUCKET, Delete={"Objects": keys, "Quiet": True})
