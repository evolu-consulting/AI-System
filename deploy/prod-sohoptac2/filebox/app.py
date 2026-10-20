"""Filebox: files kept in MinIO, found by file_id, labelled by organisation — fast in and out,
with every version kept.

Upload
  POST /files?org=&name=               the body streamed into MinIO in 16 MB parts, 4 at a time;
                                       Content-Encoding: gzip | zstd is unpacked on the way in.
  POST /files/{file_id}/versions       same, as a NEW VERSION of that file (older ones are kept)
  POST /uploads {name, org, size}      fastest for big files: presigned part URLs; the client PUTs
                                       the parts straight to MinIO in parallel, then
  POST /uploads/{upload_id}/complete {parts: [{part, etag}]}       (DELETE /uploads/{id}: abort)
                                       give "file_id" to /uploads to make it a new version
Download
  GET  /files/{file_id}/content        streamed; Range works (parallel ranged download);
                                       ?compress=zstd|gzip shrinks it on the fly; ?version=
  GET  /files/{file_id}/url            a presigned MinIO URL (ranged reads, no hop); ?version=
Find
  GET  /files/{file_id}   GET /files/{file_id}/versions   GET /files?org=   DELETE /files/{file_id}

Storage: one versioned bucket, key <org-slug>/<file_id>/<name>; MinIO compresses text formats at
rest. A SQLite index maps file_id -> object, name, org, size. Every call needs
`Authorization: Bearer $FILEBOX_TOKEN`. Run: uvicorn app:app --port 9100.
"""

import asyncio
import hashlib
import hmac
import ipaddress
import math
import os
import re
import secrets
import sqlite3
import time
import urllib.parse
import uuid
import zlib
from contextlib import closing

import boto3
import zstandard
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

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
app = FastAPI(title="Filebox", description=__doc__)


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


# ---- auth --------------------------------------------------------------------------------------
# Open without the key: the web page (it asks for the key), the API docs (no data), health, and
# signed download links (/d/..., each signed for one file and version, for LINK_SECONDS).
_OPEN = ("/", "/health", "/docs", "/openapi.json")


@app.middleware("http")
async def _auth(request: Request, call_next):
    path = request.url.path
    given = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if (
        path not in _OPEN
        and not path.startswith("/d/")
        and not (TOKEN and secrets.compare_digest(given, TOKEN))
    ):
        return JSONResponse({"error": "a valid Bearer token is required"}, status_code=401)
    return await call_next(request)


@app.get("/", include_in_schema=False)
def web():
    return FileResponse(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "web.html"),
        headers={"Cache-Control": "no-store"},
    )


@app.on_event("startup")
def _startup():
    _init()


@app.get("/health")
def health():
    return {"ok": True}


# ---- streamed upload ---------------------------------------------------------------------------
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


async def _stream_parts(request, row):
    """Body -> multipart upload, IN_FLIGHT parts at a time. Returns (size, version_id)."""
    unpack = _unpacker(request.headers.get("content-encoding"))
    up = await asyncio.to_thread(
        s3.create_multipart_upload,
        Bucket=BUCKET,
        Key=row["key"],
        ContentType=row["content_type"],
        Metadata=_meta(row, None),
    )
    upload_id, size, n, buf, tasks = up["UploadId"], 0, 0, bytearray(), []
    gate = asyncio.Semaphore(IN_FLIGHT)

    async def send(number, data):
        async with gate:
            res = await asyncio.to_thread(
                s3.upload_part,
                Bucket=BUCKET,
                Key=row["key"],
                UploadId=upload_id,
                PartNumber=number,
                Body=bytes(data),
            )
            return {"PartNumber": number, "ETag": res["ETag"]}

    try:
        async for chunk in request.stream():
            buf += unpack(chunk)
            while len(buf) >= PART:
                n, size = n + 1, size + PART
                tasks.append(asyncio.create_task(send(n, buf[:PART])))
                del buf[:PART]
                while sum(not t.done() for t in tasks) >= IN_FLIGHT * 2:  # bounded memory
                    await asyncio.sleep(0.01)
        if buf or n == 0:
            n, size = n + 1, size + len(buf)
            tasks.append(asyncio.create_task(send(n, buf)))
        parts = await asyncio.gather(*tasks)
        done = await asyncio.to_thread(
            s3.complete_multipart_upload,
            Bucket=BUCKET,
            Key=row["key"],
            UploadId=upload_id,
            MultipartUpload={"Parts": parts},
        )
    except BaseException:
        for t in tasks:  # stop the parts still waiting, let the running ones end, then abort
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await asyncio.to_thread(s3.abort_multipart_upload, Bucket=BUCKET, Key=row["key"], UploadId=upload_id)
        raise
    return size, done.get("VersionId")


async def _receive(request, row):
    try:
        size, version_id = await _stream_parts(request, row)
    except (ClientError, zlib.error, zstandard.ZstdError) as exc:
        raise HTTPException(400, f"upload failed: {exc}") from exc
    return _stored(row["file_id"], size, version_id, None)


@app.post("/files", summary="Upload a file (body streamed; gzip / zstd Content-Encoding accepted)")
async def upload(request: Request, org: str, name: str):
    return await _receive(request, _new(org, name, request.headers.get("content-type")))


@app.post("/files/{file_id}/versions", summary="Upload a new version of a file (older ones are kept)")
async def upload_version(file_id: str, request: Request):
    return await _receive(request, _row(file_id))


# ---- direct parallel multipart -----------------------------------------------------------------
MAX_API_PART = 256 * 1024**2  # a part sent through the API is held in memory once


class StartUpload(BaseModel):
    org: str | None = None  # a new file: org and name; a new version: file_id
    name: str | None = None
    file_id: str | None = None
    size: int = Field(gt=0, le=5 * 1024**4)  # bytes (5 TiB, the S3 object limit)
    content_type: str | None = None
    encoding: str | None = Field(None, pattern="^(zstd|gzip)$")  # the client shrank it before upload
    part_size: int | None = Field(None, ge=5 * 1024**2, le=5 * 1024**3)
    # False (default): PUT each part to this API (/uploads/{id}/parts/{n}) — works from anywhere.
    # True: presigned URLs straight to storage — only where storage is reachable (on the server).
    direct: bool = False


class Part(BaseModel):
    part: int = Field(ge=1, le=MAX_PARTS)
    etag: str


class Complete(BaseModel):
    parts: list[Part] = Field(min_length=1, max_length=MAX_PARTS)


@app.post("/uploads", summary="Start a parallel upload: presigned part URLs straight to storage")
def start_upload(req: StartUpload, request: Request):
    if req.file_id:
        row = _row(req.file_id)
    elif req.org and req.name:
        row = _new(req.org, req.name, req.content_type)
    else:
        raise HTTPException(422, "give org and name (a new file) or file_id (a new version)")
    part = max(req.part_size or (64 if req.direct else 32) * 1024**2, math.ceil(req.size / MAX_PARTS))
    if not req.direct and part > MAX_API_PART:
        raise HTTPException(422, "too big to send through the API in parts of at most 256 MB — use direct")
    up = s3.create_multipart_upload(
        Bucket=BUCKET, Key=row["key"], ContentType=row["content_type"], Metadata=_meta(row, req.encoding)
    )
    with closing(_db()) as con:
        con.execute(
            "INSERT INTO uploads VALUES(?,?,?,?)", (up["UploadId"], row["file_id"], req.encoding, time.time())
        )
        con.commit()
    count = math.ceil(req.size / part)
    if req.direct:
        urls = [
            {
                "part": n,
                "url": _links(request).generate_presigned_url(
                    "upload_part",
                    ExpiresIn=URL_SECONDS,
                    Params={"Bucket": BUCKET, "Key": row["key"], "UploadId": up["UploadId"], "PartNumber": n},
                ),
            }
            for n in range(1, count + 1)
        ]
    else:  # relative: PUT them to this API with the same Bearer token
        urls = [{"part": n, "path": f"/uploads/{up['UploadId']}/parts/{n}"} for n in range(1, count + 1)]
    return {
        "file_id": row["file_id"],
        "upload_id": up["UploadId"],
        "part_size": part,
        "parts": urls,
        "direct": req.direct,
        "expires_in": URL_SECONDS,
    }


@app.put("/uploads/{upload_id}/parts/{part}", summary="Send one part through the API (parallel PUTs)")
async def upload_part(upload_id: str, part: int, request: Request):
    up, row = _upload(upload_id)
    if not 1 <= part <= MAX_PARTS:
        raise HTTPException(422, f"part must be 1-{MAX_PARTS}")
    if int(request.headers.get("content-length") or 0) > MAX_API_PART:
        raise HTTPException(413, "a part sent through the API is at most 256 MB")
    body = await request.body()
    if not body or len(body) > MAX_API_PART:
        raise HTTPException(422, "the part is empty or larger than 256 MB")
    try:
        res = await asyncio.to_thread(
            s3.upload_part, Bucket=BUCKET, Key=row["key"], UploadId=upload_id, PartNumber=part, Body=body
        )
    except ClientError as exc:
        raise HTTPException(400, f"could not store the part: {exc}") from exc
    return {"part": part, "etag": res["ETag"], "size": len(body)}


def _upload(upload_id):
    with closing(_db()) as con:
        up = con.execute("SELECT * FROM uploads WHERE upload_id=?", (upload_id,)).fetchone()
    if up is None:
        raise HTTPException(404, "upload not found (finished, aborted or unknown)")
    return dict(up), _row(up["file_id"], ready=False)


def _forget(upload_id):
    with closing(_db()) as con:
        con.execute("DELETE FROM uploads WHERE upload_id=?", (upload_id,))
        con.commit()


@app.post("/uploads/{upload_id}/complete", summary="Finish a parallel upload")
def complete_upload(upload_id: str, req: Complete):
    up, row = _upload(upload_id)
    parts = [{"PartNumber": p.part, "ETag": p.etag} for p in sorted(req.parts, key=lambda p: p.part)]
    try:
        done = s3.complete_multipart_upload(
            Bucket=BUCKET, Key=row["key"], UploadId=upload_id, MultipartUpload={"Parts": parts}
        )
        head = s3.head_object(Bucket=BUCKET, Key=row["key"], VersionId=done["VersionId"])
    except ClientError as exc:
        raise HTTPException(400, f"could not finish the upload: {exc}") from exc
    _forget(upload_id)
    return _stored(row["file_id"], head["ContentLength"], done.get("VersionId"), up["encoding"])


@app.delete("/uploads/{upload_id}", summary="Abort a parallel upload")
def abort_upload(upload_id: str):
    up, row = _upload(upload_id)
    s3.abort_multipart_upload(Bucket=BUCKET, Key=row["key"], UploadId=upload_id)
    _forget(upload_id)
    if row["versions"] == 0:  # its first upload never landed: no file is left behind
        with closing(_db()) as con:
            con.execute(
                "UPDATE files SET state='aborted', updated=? WHERE file_id=?", (time.time(), row["file_id"])
            )
            con.commit()
    return {"aborted": upload_id}


# ---- download ----------------------------------------------------------------------------------
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


@app.get("/files/{file_id}/content", summary="Download (Range for parallel parts; ?compress=; ?version=)")
def download(file_id: str, request: Request, compress: str | None = None, version: str | None = None):
    row = _row(file_id)
    if compress not in (None, "zstd", "gzip"):
        raise HTTPException(422, "compress must be zstd or gzip")
    rng = request.headers.get("range")
    if rng and compress:
        raise HTTPException(422, "a Range download cannot also be compressed")
    try:
        obj = s3.get_object(
            Bucket=BUCKET, Key=row["key"], **({"Range": rng} if rng else {}), **_version(version)
        )
    except ClientError as exc:
        raise HTTPException(
            416 if "InvalidRange" in str(exc) else 404, "no such file, version or range"
        ) from exc
    name = row["name"] + {"zstd": ".zst", "gzip": ".gz"}.get(compress, "")
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f'attachment; filename="{name}"',
        "X-File-Encoding": obj.get("Metadata", {}).get("encoding", "identity"),
        "X-Version-Id": obj.get("VersionId") or "",
    }
    if compress:
        return StreamingResponse(
            _squeezed(_chunks(obj["Body"]), compress),
            headers=headers,
            media_type="application/zstd" if compress == "zstd" else "application/gzip",
        )
    headers["Content-Length"] = str(obj["ContentLength"])
    if rng:
        headers["Content-Range"] = obj["ContentRange"]
    return StreamingResponse(
        _chunks(obj["Body"]), status_code=206 if rng else 200, headers=headers, media_type=row["content_type"]
    )


@app.get("/files/{file_id}/url", summary="A presigned storage URL (ranged, parallel reads); ?version=")
def download_url(file_id: str, request: Request, version: str | None = None):
    row = _row(file_id)
    try:
        head = s3.head_object(Bucket=BUCKET, Key=row["key"], **_version(version))
    except ClientError as exc:
        raise HTTPException(404, "no such version") from exc
    url = _links(request).generate_presigned_url(
        "get_object", ExpiresIn=URL_SECONDS, Params={"Bucket": BUCKET, "Key": row["key"], **_version(version)}
    )
    return {
        **_public(row),
        "size": head["ContentLength"],
        "encoding": head.get("Metadata", {}).get("encoding"),
        "version_id": head.get("VersionId"),
        "url": url,
        "expires_in": URL_SECONDS,
    }


# ---- signed download links (for browsers: no header needed) ------------------------------------
LINK_SECONDS = 600
_LINK_KEY = hashlib.sha256(("filebox-link:" + TOKEN).encode()).digest()


def _sign(file_id, version, exp):
    return hmac.new(_LINK_KEY, f"{file_id}|{version}|{exp}".encode(), hashlib.sha256).hexdigest()


@app.get("/files/{file_id}/link", summary="A download link that works without the key, for 10 minutes")
def download_link(file_id: str, version: str | None = None):
    row = _row(file_id)
    try:
        head = s3.head_object(Bucket=BUCKET, Key=row["key"], **_version(version))
    except ClientError as exc:
        raise HTTPException(404, "no such version") from exc
    v, exp = head.get("VersionId") or "", int(time.time()) + LINK_SECONDS
    query = urllib.parse.urlencode({"v": v, "exp": exp, "sig": _sign(file_id, v, exp)})
    return {"url": f"/d/{file_id}?{query}", "expires_in": LINK_SECONDS}


@app.get("/d/{file_id}", include_in_schema=False)
def signed_download(file_id: str, request: Request, v: str = "", exp: int = 0, sig: str = ""):
    if exp < time.time() or not hmac.compare_digest(sig, _sign(file_id, v, exp)):
        raise HTTPException(403, "this download link has expired or is not valid — ask for a new one")
    row = _row(file_id)
    head = s3.head_object(Bucket=BUCKET, Key=row["key"], **_version(v))
    packed = head.get("Metadata", {}).get("encoding")
    rng = None if packed else request.headers.get("range")  # a shrunk file is unpacked whole
    obj = s3.get_object(Bucket=BUCKET, Key=row["key"], **({"Range": rng} if rng else {}), **_version(v))
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{urllib.parse.quote(row['name'])}",
        "Accept-Ranges": "none" if packed else "bytes",
    }
    if packed:  # kept shrunk (client --zstd): the browser gets the original file
        return StreamingResponse(
            _unpacked(_chunks(obj["Body"]), packed), headers=headers, media_type=row["content_type"]
        )
    headers["Content-Length"] = str(obj["ContentLength"])
    if rng:
        headers["Content-Range"] = obj["ContentRange"]
    return StreamingResponse(
        _chunks(obj["Body"]), status_code=206 if rng else 200, headers=headers, media_type=row["content_type"]
    )


def _unpacked(chunks, encoding):
    unpack = _unpacker(encoding)
    for chunk in chunks:
        if out := unpack(chunk):
            yield out


# ---- find / delete -----------------------------------------------------------------------------
@app.get("/files/{file_id}", summary="A file's facts (its current version)")
def file_info(file_id: str):
    return _public(_row(file_id))


def _all_versions(key):
    out, kw = [], {}
    while True:
        page = s3.list_object_versions(Bucket=BUCKET, Prefix=key, **kw)
        out += [v for v in page.get("Versions", []) if v["Key"] == key]
        out += [{**m, "marker": True} for m in page.get("DeleteMarkers", []) if m["Key"] == key]
        if not page.get("IsTruncated"):
            return out
        kw = {"KeyMarker": page["NextKeyMarker"], "VersionIdMarker": page["NextVersionIdMarker"]}


@app.get("/files/{file_id}/versions", summary="Every version of a file, newest first")
def file_versions(file_id: str):
    row = _row(file_id)
    versions = sorted(
        (v for v in _all_versions(row["key"]) if not v.get("marker")),
        key=lambda v: v["LastModified"],
        reverse=True,
    )
    return [
        {
            "version_id": v["VersionId"],
            "size": v["Size"],
            "modified": v["LastModified"].timestamp(),
            "current": v["VersionId"] == row["version_id"],
        }
        for v in versions
    ]


@app.get("/files", summary="Files of an organisation (newest first)")
def list_files(org: str | None = None, limit: int = 100):
    with closing(_db()) as con:
        rows = con.execute(
            "SELECT * FROM files WHERE state='ready' AND (:org IS NULL OR org=:org)"
            " ORDER BY created DESC LIMIT :n",
            {"org": org, "n": max(1, min(limit, 1000))},
        ).fetchall()
    return [_public(dict(r)) for r in rows]


@app.delete("/files/{file_id}", summary="Delete a file and every version of it")
def delete_file(file_id: str):
    row = _row(file_id)
    for v in _all_versions(row["key"]):
        s3.delete_object(Bucket=BUCKET, Key=row["key"], VersionId=v["VersionId"])
    with closing(_db()) as con:
        con.execute("UPDATE files SET state='deleted', updated=? WHERE file_id=?", (time.time(), file_id))
        con.commit()
    return {"deleted": file_id}
