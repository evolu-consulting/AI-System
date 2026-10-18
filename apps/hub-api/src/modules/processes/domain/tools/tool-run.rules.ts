// HUB-FR-146 · AC-H44 · PD2-R03/R05 · plan-d2-rules §1, D2-13/D2-29, Q-D2-2: dựng tham số gọi tool từ nguồn (input start /
// trường output stage trước / hằng); phân loại lỗi gọi tool + quyết định thử lại (dùng chung `decideRetry`). Thuần, lớp 1.
import type { JobErrorClass } from "../runs/job-error.rules";
import { decideRetry, type RetryDecision, type RetryState } from "../runs/retry.rules";

/** Nguồn một tham số (camelCase domain; mapper đổi từ `stage_key` của contract). */
export type ArgSource =
  | { from: "input"; key: string }
  | { from: "field"; stageKey: string; field: string }
  | { from: "const"; value: string | number | boolean };

export type ToolArgValue = string | number | boolean;
export type BuiltArgs =
  | { ok: true; values: Record<string, ToolArgValue> }
  | { ok: false; missing: string };

/** Giá trị của một nguồn; vắng (input không có, stage nguồn `skipped` = null, trường không có) ⇒ `undefined`. */
function sourceValue(
  src: ArgSource,
  inputs: ReadonlyMap<string, string>,
  fields: ReadonlyMap<string, Readonly<Record<string, string | number>> | null>,
  inputTypes: ReadonlyMap<string, string> | undefined,
): ToolArgValue | undefined {
  if (src.from === "const") return src.value;
  if (src.from === "input") {
    const v = inputs.get(src.key);
    if (v === undefined) return undefined;
    return inputTypes?.get(src.key) === "number" ? Number(v) : v;
  }
  const f = fields.get(src.stageKey);
  return f ? f[src.field] : undefined;
}

/**
 * PD2-U04/U05 · mọi tham số theo thứ tự khai; nguồn đầu tiên vắng ⇒ `{ok:false, missing:<tên tham số>}`. `inputTypes`
 * (D2-29): input kiểu `number` ⇒ `Number(value)`; không truyền ⇒ giữ chuỗi.
 */
export function buildToolArgs(
  args: Readonly<Record<string, ArgSource>>,
  inputs: ReadonlyMap<string, string>,
  fields: ReadonlyMap<string, Readonly<Record<string, string | number>> | null>,
  inputTypes?: ReadonlyMap<string, string>,
): BuiltArgs {
  const values: Record<string, ToolArgValue> = {};
  for (const [name, src] of Object.entries(args)) {
    const v = sourceValue(src, inputs, fields, inputTypes);
    if (v === undefined) return { ok: false, missing: name };
    values[name] = v;
  }
  return { ok: true, values };
}

/** Lỗi một lời gọi tool: `sent` = yêu cầu đã tới Dify (Q-D2-2: chỉ lỗi lập kết nối ⇒ false); `reason` của client Dify. */
export type ToolFailure = {
  code: string;
  httpStatus: number | null;
  sent: boolean;
  reason: string | null;
};

const TRANSIENT_TOOL_CODES: ReadonlySet<string> = new Set(["UPSTREAM_ERROR", "TIMEOUT"]);
const TRANSIENT_HTTP: ReadonlySet<number> = new Set([408, 429]);

/**
 * PD2-U06 · mã ∉ {UPSTREAM_ERROR, TIMEOUT} (NOT_CONFIGURED, INVALID_ARGS, lạ) | `invalid_output` ⇒ business; chưa gửi ⇒
 * transient; đã gửi: TIMEOUT | http null / ≥ 500 / 408 / 429 ⇒ transient; 4xx khác ⇒ business.
 */
export function classifyToolError(f: ToolFailure): JobErrorClass {
  if (!TRANSIENT_TOOL_CODES.has(f.code) || f.reason === "invalid_output") return "business";
  if (!f.sent || f.code === "TIMEOUT" || f.httpStatus === null) return "transient";
  return f.httpStatus >= 500 || TRANSIENT_HTTP.has(f.httpStatus) ? "transient" : "business";
}

/**
 * PD2-U07 · D2-13 · business ⇒ decide(tool_failed); transient ∧ sideEffect ∧ sent ⇒ decide(tool_failed) (không gọi lại,
 * PD2-R05/S4); hết lượt ⇒ decide(retry_exhausted); còn lại ⇒ retry (backoff 30 s/2'/8' của `decideRetry`).
 */
export function toolFailureDecision(i: {
  f: ToolFailure;
  sideEffect: boolean;
  state: RetryState;
  now: Date;
}): RetryDecision {
  return decideRetry({
    cls: classifyToolError(i.f),
    state: i.state,
    sideEffectSent: i.sideEffect && i.f.sent,
    legacy: "tool_failed",
    now: i.now,
  });
}
