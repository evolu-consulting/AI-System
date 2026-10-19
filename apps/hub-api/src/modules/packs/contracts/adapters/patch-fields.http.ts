// HD-AC07 · HD-AC06 · HD1 plan §1 bảng lỗi (T4): biên HTTP của PATCH trường — thân → `PatchFieldsRequestSchema`; lỗi zod →
// mã contract: khoá lạ trong `fields` ⇒ 422 `FIELD_UNKNOWN {keys}` (ưu tiên khi lẫn sai kiểu), sai kiểu/miền một khoá ⇒ 422
// `FIELD_INVALID {key}`, còn lại (thiếu/sai `version`, `fields` rỗng/không phải object, khoá thừa ở gốc như `tenant_id`) ⇒ 400
// `VALIDATION_ERROR`. Kết quả use case → 200 / 404 `NOT_FOUND` / 409 `CONTRACT_STALE {current:{version}, updated_at}`.
import { CONTRACT_ERRORS, PatchFieldsRequestSchema } from "@ai/contracts";
import type { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith } from "../../../../lib/http";
import type {
  PatchFieldsInput,
  PatchFieldsOk,
  PatchFieldsResult,
} from "../application/patch-fields.usecase";

const KEYS_MAX = 50;
const KEY_LEN_MAX = 100;

function fieldError(issues: readonly z.core.$ZodIssue[]): AppError | null {
  const unknown = issues.flatMap((i) =>
    i.code === "unrecognized_keys" && i.path.length === 1 && i.path[0] === "fields" ? i.keys : [],
  );
  if (unknown.length > 0) {
    const keys = [...new Set(unknown)].slice(0, KEYS_MAX).map((k) => k.slice(0, KEY_LEN_MAX));
    return new AppError("FIELD_UNKNOWN", CONTRACT_ERRORS.FIELD_UNKNOWN, "Unknown field", { keys });
  }
  const bad = issues.find((i) => i.path.length >= 2 && i.path[0] === "fields");
  if (!bad) return null;
  const key = String(bad.path[1]).slice(0, KEY_LEN_MAX);
  return new AppError("FIELD_INVALID", CONTRACT_ERRORS.FIELD_INVALID, "Invalid field value", {
    key,
  });
}

/** Thân JSON đã đọc → đầu vào use case; ném `AppError` 400/422. */
export function patchBody(raw: unknown): PatchFieldsInput {
  const r = PatchFieldsRequestSchema.safeParse(raw);
  if (r.success) return r.data as PatchFieldsInput;
  const fe = fieldError(r.error.issues);
  if (fe) throw fe;
  // ném 400 `VALIDATION_ERROR` với `details.issues` (luôn ném — schema vừa trượt)
  return parseWith(PatchFieldsRequestSchema, raw) as PatchFieldsInput;
}

/** Kết quả use case → thân 200 hoặc ném 404/409. */
export function patchReply(res: PatchFieldsResult): PatchFieldsOk {
  if (res.kind === "ok") return res.out;
  if (res.kind === "not_found") throw appError("NOT_FOUND");
  // Review HD3 S1 · HĐ đang duyệt / đã duyệt ⇒ không sửa trường quyết định cấp duyệt.
  if (res.kind === "in_approval")
    throw new AppError(
      "CONTRACT_IN_APPROVAL",
      409,
      "Contract is in approval; this field is locked",
    );
  if (res.kind === "locked")
    throw new AppError("CONTRACT_LOCKED", 409, "Approved contract; money fields are locked");
  if (res.kind !== "stale") throw appError("NOT_FOUND");
  throw new AppError("CONTRACT_STALE", CONTRACT_ERRORS.CONTRACT_STALE, "Contract was modified", {
    current: res.current,
    updated_at: res.updated_at,
  });
}
