// CR-118 · cr118-community-files · §11.1 "Đính kèm":
//  `POST /pack/community/files` — thân thô + `X-Filename` (percent-encoded); quyền `write`. Trần `ATTACH_MAX_BYTES` (413
//    `ATTACHMENT_TOO_LARGE`, kiểm `Content-Length` sớm rồi đếm thật), loại theo NỘI DUNG khớp đuôi `ATTACH_ALLOWED` (415
//    `ATTACHMENT_TYPE_NOT_ALLOWED`). 201 `CommunityFile`.
//  `GET /pack/community/files/:id` — quyền `read`; thấy ⇔ người tải lên ∨ thấy bài chứa tệp (RLS `files_visible`, gồm đối tác);
//    còn lại 404 giống hệt. Trả byte qua API (không 302) để giữ `attachment` + `nosniff` + CSP.
import { FILENAME_HEADER } from "@ai/contracts/chat";
import { type Context, Hono } from "hono";
import { appError } from "../../../../lib/errors";
import { parseIdParam } from "../../../../lib/http";
import type { PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { safeFileName } from "../domain/file.rules";
import { accessOf } from "./community-access";
import type { CommunityDeps } from "./community-deps";
import * as files from "./files.service";

function filenameOf(raw: string | undefined): string {
  if (!raw || !/^[\x20-\x7e]{1,1024}$/.test(raw)) throw appError("VALIDATION_ERROR");
  try {
    return safeFileName(decodeURIComponent(raw));
  } catch {
    throw appError("VALIDATION_ERROR");
  }
}

/** `Content-Length` vượt ⇒ 413 trước khi giữ lượt/đọc thân. */
function precheckLength(c: Context<PackGuardVars>, max: number): void {
  const len = c.req.header("content-length");
  if (len !== undefined && /^\d+$/.test(len) && Number(len) > max)
    throw appError("ATTACHMENT_TOO_LARGE");
}

/** Đọc thân ≤ `max` byte; vượt ⇒ 413 ngay (không đọc tiếp). */
async function readCapped(c: Context<PackGuardVars>, max: number): Promise<Uint8Array> {
  const body = c.req.raw.body;
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw appError("ATTACHMENT_TOO_LARGE");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const ch of chunks) {
    out.set(ch, off);
    off += ch.length;
  }
  return out;
}

export function filesRoutes(d: CommunityDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const slots = files.inflightSlots(d.uploadsInflight ?? files.UPLOADS_INFLIGHT);

  // cr118-files-quota: 413 sớm → chỗ đọc đồng thời (trần bộ nhớ) → giữ lượt (người/phút + tenant/ngày) → đọc thân → lưu.
  // Thất bại sau khi giữ lượt (413/415/kho/DB) ⇒ hoàn lượt ngày.
  r.post("/files", async (c) => {
    const a = await accessOf(d.view, d.resolver, c, "write");
    const name = filenameOf(c.req.header(FILENAME_HEADER));
    precheckLength(c, files.FILE_MAX_BYTES);
    const release = slots.take();
    try {
      const refund = d.gate ? await d.gate(a.who) : async () => {};
      let ok = false;
      try {
        const bytes = await readCapped(c, files.FILE_MAX_BYTES);
        const out = await files.upload(d.uow, d.blobs, a, name, bytes);
        ok = true;
        return c.json(out, 201);
      } finally {
        if (!ok) await refund();
      }
    } finally {
      release();
    }
  });

  r.get("/files/:id", async (c) => {
    const a = await accessOf(d.view, d.resolver, c, "read");
    return files.download(d.uow, d.blobs, a, parseIdParam(c).toLowerCase());
  });

  return r;
}
