// CR-104 · ops-core · registry check của ops-watch (giống registry node CR-103): mỗi check là một module cắm vào, code thường,
// 0 token AI. Chạy mỗi check với hạn giờ riêng; check ném lỗi/quá giờ ⇒ `unknown` + thông điệp, KHÔNG làm hỏng cả lượt.
import type {
  OpsCheckKey,
  OpsCheckSettings,
  OpsSettings,
  OpsStatus,
} from "@ai/contracts/hub-admin";
import type { Db } from "../../../lib/db";
import type { Redis } from "../../../lib/redis";

/** Phụ thuộc chung mọi check nhận (O2 đọc file trạng thái ở `statusDir`, gọi HTTP/TLS qua `fetch` + `signal`). */
export type OpsCheckDeps = {
  db: Db;
  redis?: Redis;
  fetch: typeof fetch;
  /** Thời điểm của lượt (đồng hồ giả trong test). */
  now: Date;
  /** Hủy khi quá hạn giờ của check — check gọi mạng PHẢI truyền tiếp. */
  signal: AbortSignal;
  /** Thư mục file trạng thái do host ghi (`ops-status/*.json`, O4); vắng ⇒ check đọc file trả `unknown`. */
  statusDir?: string;
  /** Kết quả lượt trước của từng check (đọc từ `hub.ops_checks` trước lượt) — cho check đếm lỗi liên tiếp (host công khai). */
  prev?: Readonly<Partial<Record<OpsCheckKey, { status: OpsStatus; value: unknown }>>>;
};

export type OpsCheckResult = {
  status: OpsStatus;
  /** Giá trị đo (jsonb, hiện trên thẻ), vd `{ used_pct: 83 }`. */
  value?: unknown;
  /** ≤ 500 ký tự (cắt bớt). */
  message: string;
  /** Gợi ý sửa (vd lệnh đăng nhập lại Claude CLI), ≤ 1000 ký tự. */
  hint?: string | null;
};

export type OpsCheck = {
  key: OpsCheckKey;
  /** Hạn giờ riêng (ms); vắng ⇒ mặc định của lượt. */
  timeoutMs?: number;
  /** `cfg` = cấu hình của chính check (enabled/warn/crit); `all` khi cần tham chiếu chung. */
  run(deps: OpsCheckDeps, cfg: OpsCheckSettings, all: OpsSettings): Promise<OpsCheckResult>;
};

export const OPS_CHECK_TIMEOUT_MS = 10_000;

export type OpsCheckOutcome = {
  check_key: OpsCheckKey;
  status: OpsStatus;
  value: unknown;
  message: string;
  hint: string | null;
};

const STATUSES = new Set<OpsStatus>(["ok", "warn", "crit", "unknown"]);
class OpsCheckTimeout extends Error {}

function normalize(key: OpsCheckKey, r: OpsCheckResult): OpsCheckOutcome {
  if (!r || !STATUSES.has(r.status))
    return {
      check_key: key,
      status: "unknown",
      value: null,
      message: "Kết quả check không hợp lệ",
      hint: null,
    };
  return {
    check_key: key,
    status: r.status,
    value: r.value === undefined ? null : r.value,
    message: String(r.message ?? "").slice(0, 500),
    hint: r.hint ? String(r.hint).slice(0, 1000) : null,
  };
}

/** Chạy một check với hạn giờ; lỗi ⇒ `unknown` (chỉ tên lỗi, không lộ chi tiết nội bộ). */
export async function runCheck(
  c: OpsCheck,
  base: Omit<OpsCheckDeps, "signal">,
  all: OpsSettings,
  defaultTimeoutMs = OPS_CHECK_TIMEOUT_MS,
): Promise<OpsCheckOutcome> {
  const ms = c.timeoutMs ?? defaultTimeoutMs;
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    // Báo quá giờ TRƯỚC khi hủy: check bị hủy thường ném lỗi abort — race phải thấy "quá giờ" trước.
    timer = setTimeout(() => {
      reject(new OpsCheckTimeout());
      ac.abort();
    }, ms);
  });
  try {
    const r = await Promise.race([
      c.run({ ...base, signal: ac.signal }, all.checks[c.key], all),
      expired,
    ]);
    return normalize(c.key, r);
  } catch (err) {
    const message =
      err instanceof OpsCheckTimeout
        ? `Quá thời gian kiểm (${ms} ms)`
        : `Check lỗi: ${err instanceof Error ? err.name : "unknown"}`;
    return { check_key: c.key, status: "unknown", value: null, message, hint: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Check bật trong cấu hình VÀ có trong registry, chạy song song. */
export function runEnabled(
  checks: readonly OpsCheck[],
  base: Omit<OpsCheckDeps, "signal">,
  all: OpsSettings,
  defaultTimeoutMs?: number,
): Promise<OpsCheckOutcome[]> {
  const on = checks.filter((c) => all.checks[c.key]?.enabled === true);
  return Promise.all(on.map((c) => runCheck(c, base, all, defaultTimeoutMs)));
}
