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

import hmac
import os
import secrets
import time
import urllib.parse
from contextlib import closing

from botocore.exceptions import ClientError
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from fb_core import (
    BUCKET,
    LINK_SECONDS,
    TOKEN,
    URL_SECONDS,
    _all_versions,
    _chunks,
    _db,
    _init,
    _links,
    _public,
    _row,
    _sign,
    _squeezed,
    _unpacked,
    _version,
    s3,
)
from fb_upload import router as upload_router

app = FastAPI(title="Filebox", description=__doc__)
app.include_router(upload_router)


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
