// HUB-FR-12 · HUB-FR-50 · H2c-R22 · P14 · Dify `POST /v1/files/upload` (multipart `file` + `user`, Bearer key workflow) —
// tách khỏi `DifyClient` (280 dòng). Kết quả là giá trị (không ném): lỗi HTTP → `mapDifyUploadError` (plan-errors §4), thân
// 2xx không `id` / mạng / hết `DIFY_UPLOAD_TIMEOUT_MS` → `UPSTREAM_ERROR`/`upstream` (như H2a-R11). `signal` của người gọi
// abort → `aborted` (người gọi tự quyết `TIMEOUT`/huỷ). Không log/ném app-key, không log tên file: thân lỗi chỉ ra ngoài qua
// `maskSecret(…, apiKey)` (≤ 300).
import { readBodyText } from "./dify.client";
import { type DifyHttpErrorCode, mapDifyHttpError, maskSecret } from "./dify.rules";

/** Hạn một lần upload (plan-errors §4 "hết 60 s"), độc lập với hạn lệnh. */
export const DIFY_UPLOAD_TIMEOUT_MS = 60_000;
const DIFY_UPLOAD_ID_MAX = 100;
const ERROR_BODY_READ_MAX = 8_192;
const REJECTED_CODES: ReadonlySet<string> = new Set(["file_too_large", "unsupported_file_type"]);

export type DifyUploadFailReason = "file_rejected" | "upstream";
export type DifyUploadError = { code: DifyHttpErrorCode; reason: DifyUploadFailReason };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** 401/403/404 → `NOT_CONFIGURED`; 413, 415, `body.code` ∈ {file_too_large, unsupported_file_type} → `file_rejected`. */
export function mapDifyUploadError(status: number, body: unknown): DifyUploadError {
  const code = mapDifyHttpError(status);
  if (code === "NOT_CONFIGURED") return { code, reason: "upstream" };
  const bodyCode = isObj(body) && typeof body.code === "string" ? body.code : null;
  if (status === 413 || status === 415 || (bodyCode !== null && REJECTED_CODES.has(bodyCode)))
    return { code: "UPSTREAM_ERROR", reason: "file_rejected" };
  return { code, reason: "upstream" };
}

/** `body.id` chuỗi 1–100 ký tự; khác → null. */
export function difyUploadId(body: unknown): string | null {
  if (!isObj(body) || typeof body.id !== "string") return null;
  return body.id.length >= 1 && body.id.length <= DIFY_UPLOAD_ID_MAX ? body.id : null;
}

export type DifyUploadRequest = {
  /** `workflows.base_url` (đã gồm `/v1`). */
  baseUrl: string;
  apiKey: string;
  /** `<tenant_key>:<user_id>` (H2a-R15). */
  user: string;
  file: Blob;
  /** `safe_name` (tên gửi Dify). */
  name: string;
};

export type DifyUploadResult =
  | { ok: true; id: string; status: number; ms: number }
  | {
      ok: false;
      code: DifyHttpErrorCode;
      reason: DifyUploadFailReason;
      /** HTTP status khi Dify trả lời; null với mạng/hết hạn. */
      status: number | null;
      /** Thân lỗi đã che, ≤ 300 — chỉ cho trace. */
      detail: string | null;
      ms: number;
    }
  | { ok: false; code: "ABORTED"; ms: number };

export const difyUploadUrl = (baseUrl: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/files/upload`;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Trả lời Dify → kết quả (2xx không `id` hợp lệ ⇒ `upstream`). */
async function readUpload(req: DifyUploadRequest, res: Response, ms: () => number) {
  const text = await readBodyText(res, ERROR_BODY_READ_MAX);
  const body = parseJson(text);
  if (res.ok) {
    const id = difyUploadId(body);
    if (id) return { ok: true as const, id, status: res.status, ms: ms() };
    return {
      ok: false as const,
      code: "UPSTREAM_ERROR" as const,
      reason: "upstream" as const,
      status: res.status,
      detail: null,
      ms: ms(),
    };
  }
  const e = mapDifyUploadError(res.status, body);
  const detail = text ? maskSecret(text, req.apiKey) : null;
  return { ok: false as const, ...e, status: res.status, detail, ms: ms() };
}

/** Một lần upload (không retry, không cache — T8). Không ném. */
export async function uploadDifyFile(
  req: DifyUploadRequest,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<DifyUploadResult> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const form = new FormData();
  form.append("file", req.file, req.name);
  form.append("user", req.user);
  try {
    const res = await fetchFn(difyUploadUrl(req.baseUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${req.apiKey}` },
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(DIFY_UPLOAD_TIMEOUT_MS)]),
    });
    return await readUpload(req, res, ms);
  } catch {
    if (signal.aborted) return { ok: false, code: "ABORTED", ms: ms() };
    return {
      ok: false,
      code: "UPSTREAM_ERROR",
      reason: "upstream",
      status: null,
      detail: null,
      ms: ms(),
    };
  }
}
