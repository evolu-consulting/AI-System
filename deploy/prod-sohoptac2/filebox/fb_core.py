"""Filebox core: settings, the S3 / SQLite index helpers, codecs and link signing shared by app.py and fb_upload.py."""

import hashlib
import hmac
import ipaddress
import os
import re
import sqlite3
import time
import uuid
import zlib
from contextlib import closing

import boto3
import zstandard
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import HTTPException
S3_URL = os.environ.get("FILEBOX_S3_URL", "http://127.0.0.1:9000")
BUCKET = os.environ.get("FILEBOX_BUCKET", "filebox")
TOKEN = os.environ.get("FILEBOX_TOKEN", "")
DB = os.environ.get("FILEBOX_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "filebox.db"))
PART = 16 * 1024 * 1024  # streamed uploads: part size
IN_FLIGHT = 4  # streamed uploads: parts sent at once
MAX_PARTS = 10_000  # the S3 limit
URL_SECONDS = 3600
_ID = re.compile(r"^[0-9a-f]{16}$")

S3_PUBLIC_URL = os.environ.get("FILEBOX_S3_PUBLIC_URL") or S3_URL  # what presigned URLs name
# A client that reached Filebox by IP (and trusts filebox.crt) gets links that name the IP too.
S3_IP_URL = os.environ.get("FILEBOX_S3_IP_URL") or None
S3_CA = os.environ.get("FILEBOX_S3_CA") or None  # MinIO's (self-signed) certificate


def _client(endpoint):
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.environ.get("MINIO_ROOT_USER"),
        aws_secret_access_key=os.environ.get("MINIO_ROOT_PASSWORD"),
        region_name="us-east-1",
        verify=S3_CA if endpoint.startswith("https") else None,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, max_pool_connections=64),
    )


s3 = _client(S3_URL)  # every call the API makes itself
s3_links = _client(S3_PUBLIC_URL)  # only signs URLs that clients elsewhere will call (no request is sent)
s3_links_ip = _client(S3_IP_URL) if S3_IP_URL else s3_links


def _links(request):
    """The signer for this client: links naming the IP when it came by IP, else the public name."""
    try:
        ipaddress.ip_address(request.url.hostname or "")
    except ValueError:
        return s3_links
    return s3_links_ip


# ---- index -------------------------------------------------------------------------------------
def _db():
    con = sqlite3.connect(DB, timeout=30)
    con.row_factory = sqlite3.Row
    return con


def _init():
    with closing(_db()) as con:
        con.executescript(
            "CREATE TABLE IF NOT EXISTS files(file_id TEXT PRIMARY KEY, org TEXT NOT NULL,"
            " name TEXT NOT NULL, key TEXT NOT NULL, size INTEGER, content_type TEXT, encoding TEXT,"
            " state TEXT NOT NULL, version_id TEXT, versions INTEGER NOT NULL DEFAULT 0,"
            " created REAL NOT NULL, updated REAL);"
            "CREATE INDEX IF NOT EXISTS files_org ON files(org, created);"
            "CREATE TABLE IF NOT EXISTS uploads(upload_id TEXT PRIMARY KEY, file_id TEXT NOT NULL,"
            " encoding TEXT, created REAL NOT NULL);"
        )
        con.commit()
    try:
        s3.create_bucket(Bucket=BUCKET)
    except ClientError as exc:  # several workers start at once: one creates it, the rest find it
        if exc.response.get("Error", {}).get("Code") not in (
            "BucketAlreadyOwnedByYou",
            "BucketAlreadyExists",
        ):
            raise
    s3.put_bucket_versioning(Bucket=BUCKET, VersioningConfiguration={"Status": "Enabled"})


def _row(file_id, ready=True):
    if not _ID.match(file_id or ""):
        raise HTTPException(404, "file not found")
    with closing(_db()) as con:
        row = con.execute("SELECT * FROM files WHERE file_id=?", (file_id,)).fetchone()
    if row is None or (ready and row["state"] != "ready"):
        raise HTTPException(404, "file not found")
    return dict(row)


def _public(row):
    keep = (
        "file_id",
        "org",
        "name",
        "size",
        "content_type",
        "encoding",
        "state",
        "version_id",
        "versions",
        "created",
        "updated",
    )
    return {k: row[k] for k in keep}


def _slug(org):
    return re.sub(r"[^a-z0-9-]+", "-", org.lower()).strip("-")[:60] or "org"


def _new(org, name, content_type):
    org, name = org.strip(), os.path.basename(name.strip().replace("\\", "/"))
    if not org or len(org) > 200 or not name or len(name) > 255:
        raise HTTPException(422, "org (1-200 characters) and name (1-255 characters) are required")
    file_id = uuid.uuid4().hex[:16]
    row = {
        "file_id": file_id,
        "org": org,
        "name": name,
        "key": f"{_slug(org)}/{file_id}/{name}",
        "content_type": content_type or "application/octet-stream",
        "created": time.time(),
    }
    with closing(_db()) as con:
        con.execute(
            "INSERT INTO files(file_id, org, name, key, content_type, state, created) "
            "VALUES(:file_id,:org,:name,:key,:content_type,'uploading',:created)",
            row,
        )
        con.commit()
    return _row(file_id, ready=False)


def _stored(file_id, size, version_id, encoding):
    """A version landed: it becomes the file's current one."""
    with closing(_db()) as con:
        con.execute(
            "UPDATE files SET state='ready', size=?, version_id=?, encoding=?, versions=versions+1,"
            " updated=? WHERE file_id=?",
            (size, version_id, encoding, time.time(), file_id),
        )
        con.commit()
    return _public(_row(file_id))


def _meta(row, encoding):
    org = row["org"].encode("unicode_escape").decode("ascii")  # S3 metadata is ASCII
    return {"org": org, "file-id": row["file_id"], **({"encoding": encoding} if encoding else {})}



# ---- codecs ------------------------------------------------------------------------------------
def _frames(new):
    """Unpack chunk by chunk across frames / members (pigz, zstd -T and concatenated files make several)."""
    state = {"d": new()}

    def unpack(chunk):
        out = []
        while chunk:
            d = state["d"]
            out.append(d.decompress(chunk))
            if not d.eof:
                break
            chunk, state["d"] = d.unused_data, new()
        return b"".join(out)

    return unpack


def _unpacker(encoding):
    enc = (encoding or "identity").lower()
    if enc == "gzip":
        return _frames(lambda: zlib.decompressobj(16 + zlib.MAX_WBITS))
    if enc == "zstd":
        dctx = zstandard.ZstdDecompressor()
        return _frames(dctx.decompressobj)
    if enc == "identity":
        return lambda b: b
    raise HTTPException(415, "Content-Encoding must be gzip or zstd (or none)")


def _chunks(body, size=4 * 1024 * 1024):
    try:
        while chunk := body.read(size):
            yield chunk
    finally:
        body.close()


def _squeezed(chunks, how):
    c = (
        zstandard.ZstdCompressor(level=3, threads=-1).compressobj()
        if how == "zstd"
        else zlib.compressobj(6, zlib.DEFLATED, 16 + zlib.MAX_WBITS)
    )
    for chunk in chunks:
        if out := c.compress(chunk):
            yield out
    yield c.flush()


def _version(version):
    return {"VersionId": version} if version else {}



def _unpacked(chunks, encoding):
    unpack = _unpacker(encoding)
    for chunk in chunks:
        if out := unpack(chunk):
            yield out


# ---- signed links -------------------------------------------------------------------------------
LINK_SECONDS = 600
_LINK_KEY = hashlib.sha256(("filebox-link:" + TOKEN).encode()).digest()


def _sign(file_id, version, exp):
    return hmac.new(_LINK_KEY, f"{file_id}|{version}|{exp}".encode(), hashlib.sha256).hexdigest()



def _all_versions(key):
    out, kw = [], {}
    while True:
        page = s3.list_object_versions(Bucket=BUCKET, Prefix=key, **kw)
        out += [v for v in page.get("Versions", []) if v["Key"] == key]
        out += [{**m, "marker": True} for m in page.get("DeleteMarkers", []) if m["Key"] == key]
        if not page.get("IsTruncated"):
            return out
        kw = {"KeyMarker": page["NextKeyMarker"], "VersionIdMarker": page["NextVersionIdMarker"]}

