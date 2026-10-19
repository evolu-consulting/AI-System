// HD-FR-08 · HD-AC09 · HD-AC10 · D-06 · D-09 · plan §1–§2: `POST /pack/contracts/contracts` (multipart `file` + `kind`,
// `parent_id`, `title`). Guard `write` TRƯỚC khi đọc body (403 không chạm FileBox/quota). `bodyLimit` cắt sớm theo
// `Content-Length` (413 `FILE_TOO_LARGE`), kiểm lại kích thước tệp sau khi parse. Không tin đuôi/mime khai báo (magic bytes).
import { CONTRACT_ERRORS, UploadContractFormSchema } from "@ai/contracts";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AppError, appError } from "../../../../lib/errors";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { UploadError } from "../application/upload-contract.ports";
import type { UploadContract } from "../application/upload-contract.usecase";

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
};
const STATUS = { ...CONTRACT_ERRORS, DOCX_BUSY: 503 } as const;
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

/** Tên tệp an toàn để lưu: bỏ đường dẫn + ký tự điều khiển, NFC, ≤ 255. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const visible = [...base].filter((ch) => ch.charCodeAt(0) >= 0x20 && ch !== "\u007f");
  const s = visible.join("").normalize("NFC").trim();
  return (s || "file").slice(0, NAME_MAX);
}
/** Tiêu đề mặc định = tên tệp bỏ đuôi (≤ 200). */
export function defaultTitle(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = (dot > 0 ? name.slice(0, dot) : name).trim();
  return (stem || name).slice(0, TITLE_MAX);
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

export function uploadRoutes(view: PackAccessView, d: UploadRoutesDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.post(
    "/contracts",
    packGuard(view, CONTRACTS_KEY, "write"),
    limitBody(d.maxBytes + MULTIPART_SLACK),
    async (c) => {
      const form = await c.req.formData().catch(() => null);
      if (!form) throw appError("VALIDATION_ERROR");
      const f = formFields(form);
      const file = form.get("file");
      if (!(file instanceof File)) throw appError("VALIDATION_ERROR");
      if (file.size > d.maxBytes) throw tooLarge();
      const u = c.get("user");
      const who = { tenantId: u.tenantId, userId: u.userId };
      const name = cleanFileName(file.name);
      try {
        const out = await d.upload({
          who,
          timeZone: await d.timeZoneOf(who.tenantId),
          bytes: new Uint8Array(await file.arrayBuffer()),
          name,
          title: f.title ?? defaultTitle(name),
          kind: f.kind,
          parentId: f.parent_id ?? null,
        });
        return c.json(out, 201);
      } catch (e) {
        throw e instanceof UploadError ? toAppError(e) : e;
      }
    },
  );
  return r;
}
