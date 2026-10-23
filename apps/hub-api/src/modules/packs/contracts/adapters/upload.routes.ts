// HD-FR-08 · HD-AC09 · HD-AC10 · D-06 · D-09 · plan §1–§2: `POST /pack/contracts/contracts` (multipart `file` + `kind`,
// `parent_id`, `title`). Guard `write` TRƯỚC khi đọc body (403 không chạm FileBox/quota). `bodyLimit` cắt sớm theo
// `Content-Length` (413 `FILE_TOO_LARGE`), kiểm lại kích thước tệp sau khi parse. Không tin đuôi/mime khai báo (magic bytes).
import {
  CONTRACT_ERRORS,
  LOCK_ERRORS,
  UploadContractFormSchema,
  VERSION_ERRORS,
} from "@ai/contracts";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { UploadError } from "../application/upload-contract.ports";
import type { UploadContract, UploadContractInput } from "../application/upload-contract.usecase";

const CONTRACTS_KEY = "contracts";
/** Phần dư cho khung multipart (ranh giới, header phần, trường chữ). */
const MULTIPART_SLACK = 64 * 1024;
const NAME_MAX = 255;
const TITLE_MAX = 200;
/** Trần đọc bỏ khi trả 413 (lớn hơn ⇒ huỷ luồng). */
const DRAIN_CAP = 64 * 1024 * 1024;

export type UploadRoutesDeps = {
  upload: UploadContract;
  maxBytes: number;
  timeZoneOf: (tenantId: string) => Promise<string>;
};

const MESSAGES: Record<UploadError["code"], string> = {
  FILE_TOO_LARGE: "File too large",
  FILE_TYPE: "File type not allowed",
  PARENT_INVALID: "Invalid parent contract",
  UPLOAD_QUOTA: "Upload quota exceeded",
  UPLOAD_QUOTA_UNAVAILABLE: "Upload quota unavailable",
  DOCX_BUSY: "Document converter busy",
  NOT_FOUND: "Not found",
  VERSION_NOT_ALLOWED: "Appendices have no versions",
  CONTRACT_SUPERSEDED: "Contract version has been superseded",
  CONTRACT_NOT_LOCKED: "Contract is not confirmed",
  VERSION_DRAFT_EXISTS: "An updated version is already pending",
};
const STATUS = {
  ...CONTRACT_ERRORS,
  ...VERSION_ERRORS,
  CONTRACT_NOT_LOCKED: LOCK_ERRORS.CONTRACT_NOT_LOCKED,
  DOCX_BUSY: 503,
  NOT_FOUND: 404,
} as const;
const VersionFormSchema = UploadContractFormSchema.pick({ title: true });
const toAppError = (e: UploadError) =>
  new AppError(e.code, STATUS[e.code], MESSAGES[e.code], e.details);
const tooLarge = () => toAppError(new UploadError("FILE_TOO_LARGE"));

/** Đọc bỏ thân tới `cap` byte để trả 413 trên kết nối sạch (Bun đóng socket khi còn thân chưa đọc ⇒ client ECONNRESET). */
async function drain(body: ReadableStream<Uint8Array> | null, cap: number): Promise<void> {
  const rd = body?.getReader();
  if (!rd) return;
  for (let n = 0; ; ) {
    const { done, value } = await rd.read();
    if (done) return;
    n += value.byteLength;
    if (n > cap) return void (await rd.cancel());
  }
}

/** `Content-Length` vượt ⇒ 413 ngay (không parse, không chạm quota/FileBox); thân chunked ⇒ `bodyLimit` đếm khi đọc. */
function limitBody(max: number): MiddlewareHandler {
  const limit = bodyLimit({ maxSize: max, onError: () => Promise.reject(tooLarge()) });
  return async (c, next) => {
    const len = Number(c.req.header("content-length"));
    if (Number.isFinite(len) && len > max) {
      await drain(c.req.raw.body, DRAIN_CAP);
      throw tooLarge();
    }
    return limit(c, next);
  };
}

/** Ký tự điều khiển C0/DEL/C1 (`\p{Cc}`) + điều khiển hướng chữ (giả đuôi tệp trên UI) — review m-10. */
const isHidden = (ch: string): boolean => {
  const c = ch.codePointAt(0) ?? 0;
  const bidi = c === 0x200e || c === 0x200f || (c >= 0x202a && c <= 0x202e);
  return /\p{Cc}/u.test(ch) || bidi || (c >= 0x2066 && c <= 0x2069);
};
/** Cắt ≤ `max` đơn vị UTF-16 (trần zod) theo ranh giới điểm mã — không tách đôi cặp surrogate. */
export function cutCodePoints(s: string, max: number): string {
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/** Tên tệp an toàn để lưu: bỏ đường dẫn + ký tự điều khiển/hướng chữ, NFC, ≤ 255 điểm mã. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const visible = [...base].filter((ch) => !isHidden(ch));
  const s = visible.join("").normalize("NFC").trim();
  return cutCodePoints(s || "file", NAME_MAX);
}
/** Tiêu đề mặc định = tên tệp bỏ đuôi (≤ 200 điểm mã). */
export function defaultTitle(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = (dot > 0 ? name.slice(0, dot) : name).trim();
  return cutCodePoints(stem || name, TITLE_MAX);
}

/** Tên khai báo của phần tệp; thiếu/không phải chuỗi (Blob trần, Bun 1.3.14 với phần rỗng) ⇒ "". */
export function fileNameOf(file: Blob): string {
  const n = (file as { name?: unknown }).name;
  return typeof n === "string" ? n : "";
}

function formFields(form: FormData) {
  const pick: Record<string, string> = {};
  for (const k of ["kind", "parent_id", "title"]) {
    const v = form.get(k);
    if (typeof v === "string" && v !== "") pick[k] = v;
  }
  const p = UploadContractFormSchema.safeParse(pick);
  if (!p.success) throw appError("VALIDATION_ERROR");
  return p.data;
}

/** FileBox chưa cấu hình ⇒ tải lên trả 503 `FILE_STORAGE_UNAVAILABLE` (thay vì 404 do route không được gắn). Guard `write` trước. */
export function uploadUnavailableRoutes(view: PackAccessView): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const off = () => {
    throw new AppError("FILE_STORAGE_UNAVAILABLE", 503, "File storage (FileBox) is not configured");
  };
  r.post("/contracts", packGuard(view, CONTRACTS_KEY, "write"), off);
  r.post("/contracts/:id/versions", packGuard(view, CONTRACTS_KEY, "write"), off);
  return r;
}

/** Đọc multipart + tệp (cùng kiểm cho tải mới và bản cập nhật); 413/415/400 trước khi chạm quota/FileBox. */
async function readUpload(c: Context<PackGuardVars>, maxBytes: number) {
  const form = await c.req.formData().catch(() => null);
  if (!form) throw appError("VALIDATION_ERROR");
  const file = form.get("file");
  if (!(file instanceof Blob)) throw appError("VALIDATION_ERROR");
  if (file.size > maxBytes) throw tooLarge();
  // Tệp rỗng ⇒ 415 trước khi chạm quota/FileBox. Bun 1.3.14 trả phần rỗng là Blob không có `name`
  // (vẫn qua `instanceof File`) ⇒ không tin `name` là chuỗi (TECH-DEBT #233).
  if (file.size === 0) throw toAppError(new UploadError("FILE_TYPE"));
  const u = c.get("user");
  return {
    form,
    who: { tenantId: u.tenantId, userId: u.userId },
    name: cleanFileName(fileNameOf(file)),
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

export function uploadRoutes(view: PackAccessView, d: UploadRoutesDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const write = packGuard(view, CONTRACTS_KEY, "write");
  const limit = limitBody(d.maxBytes + MULTIPART_SLACK);
  const run = async (c: Context<PackGuardVars>, i: Omit<UploadContractInput, "timeZone">) => {
    try {
      const out = await d.upload({ ...i, timeZone: await d.timeZoneOf(i.who.tenantId) });
      return c.json(out, 201);
    } catch (e) {
      throw e instanceof UploadError ? toAppError(e) : e;
    }
  };
  r.post("/contracts", write, limit, async (c) => {
    const x = await readUpload(c, d.maxBytes);
    const f = formFields(x.form);
    const { form: _f, ...rest } = x;
    return run(c, {
      ...rest,
      title: f.title ?? defaultTitle(x.name),
      kind: f.kind,
      parentId: f.parent_id ?? null,
    });
  });
  // CR-097 K2 · HD-FR-101 "Tải bản cập nhật": cùng đường tải lên/AI đọc; HĐ phải thấy + hiện hành + đã khoá (kiểm trong câu ghi).
  r.post("/contracts/:id/versions", write, limit, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const x = await readUpload(c, d.maxBytes);
    const t = x.form.get("title");
    const p = VersionFormSchema.safeParse(typeof t === "string" && t !== "" ? { title: t } : {});
    if (!p.success) throw appError("VALIDATION_ERROR");
    const { form: _f, ...rest } = x;
    // Tiêu đề trống ⇒ giữ tiêu đề bản cũ (repo `coalesce(nullif(title,''), bản cũ)`).
    return run(c, {
      ...rest,
      title: p.data.title ?? "",
      kind: "contract",
      parentId: null,
      supersedes: id,
    });
  });
  return r;
}
