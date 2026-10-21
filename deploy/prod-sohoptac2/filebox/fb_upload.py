"""Filebox uploads: the streamed upload, new versions, and the parallel multipart API (/uploads)."""

import asyncio
import math
import time
import zlib
from contextlib import closing

import zstandard
from botocore.exceptions import ClientError
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from fb_core import (
    BUCKET,
    IN_FLIGHT,
    MAX_PARTS,
    PART,
    URL_SECONDS,
    _db,
    _links,
    _meta,
    _new,
    _row,
    _stored,
    _unpacker,
    s3,
)

router = APIRouter()

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


@router.post("/files", summary="Upload a file (body streamed; gzip / zstd Content-Encoding accepted)")
async def upload(request: Request, org: str, name: str):
    return await _receive(request, _new(org, name, request.headers.get("content-type")))


@router.post("/files/{file_id}/versions", summary="Upload a new version of a file (older ones are kept)")
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


@router.post("/uploads", summary="Start a parallel upload: presigned part URLs straight to storage")
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


@router.put("/uploads/{upload_id}/parts/{part}", summary="Send one part through the API (parallel PUTs)")
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


@router.post("/uploads/{upload_id}/complete", summary="Finish a parallel upload")
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


@router.delete("/uploads/{upload_id}", summary="Abort a parallel upload")
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
