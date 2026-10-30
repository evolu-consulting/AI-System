// CR-104 · ops-checks · "Provider AI": đọc `hub.provider_state` (agent-runtime ghi). crit: có provider logged_out/error hoặc không
// provider nào ok; warn: cooldown/busy kéo dài quá `warn` phút. Một câu SQL. `last_error` chỉ hiện sau khi làm sạch.

import { sql } from "drizzle-orm";
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import { minutesBetween, scrub, systemRead, thresholds } from "./check-kit";

export type ProviderRow = {
  provider_key: string;
  status: "ok" | "busy" | "cooldown" | "error" | "logged_out";
  updated_at: Date | string;
  last_error: string | null;
};

export const HINT_LOGGED_OUT =
  "Đăng nhập lại Claude CLI trên host rồi chạy gen-env.sh (README deploy mục Claude)";
const HINT_ERROR =
  "Xem `docker compose logs --tail 100 agent-runtime` để biết lỗi provider; sửa cấu hình/khoá rồi chờ lượt thăm dò kế tiếp.";
const HINT_SLOW =
  "Provider bị giới hạn/bận lâu: xem hạn mức tài khoản, giảm tải hoặc chờ hết cooldown; nếu kéo dài, kiểm tra agent-runtime.";

const names = (rs: readonly ProviderRow[]) => rs.map((r) => r.provider_key).join(", ");

function critProvider(
  rows: readonly ProviderRow[],
  bad: readonly ProviderRow[],
  value: unknown,
): OpsCheckResult {
  const out = bad.filter((r) => r.status === "logged_out");
  const detail = scrub(bad.find((r) => r.last_error)?.last_error);
  const message =
    bad.length > 0
      ? `Provider lỗi: ${names(bad)}${out.length > 0 ? " (đã đăng xuất)" : ""}${detail ? ` — ${detail}` : ""}`
      : `Không provider nào sẵn sàng (${rows.map((r) => `${r.provider_key}: ${r.status}`).join(", ")})`;
  const hint = out.length > 0 ? HINT_LOGGED_OUT : bad.length > 0 ? HINT_ERROR : HINT_SLOW;
  return { status: "crit", value, message, hint };
}

/** Thuần: đánh giá danh sách provider tại `now` với ngưỡng warn (phút). */
export function evaluateProvider(
  rows: readonly ProviderRow[],
  now: Date,
  warnMin: number,
): OpsCheckResult {
  if (rows.length === 0)
    return { status: "unknown", message: "Chưa có provider nào được bật để theo dõi" };
  const value = { providers: rows.map((r) => ({ key: r.provider_key, status: r.status })) };
  const bad = rows.filter((r) => r.status === "logged_out" || r.status === "error");
  const ok = rows.filter((r) => r.status === "ok");
  if (bad.length > 0 || ok.length === 0) return critProvider(rows, bad, value);
  const slow = rows.filter(
    (r) =>
      (r.status === "cooldown" || r.status === "busy") &&
      minutesBetween(now, new Date(r.updated_at)) > warnMin,
  );
  if (slow.length > 0)
    return {
      status: "warn",
      value,
      message: `Provider ${names(slow)} ở cooldown/busy quá ${warnMin} phút`,
      hint: HINT_SLOW,
    };
  return { status: "ok", value, message: `${ok.length}/${rows.length} provider sẵn sàng` };
}

export const providerCheck: OpsCheck = {
  key: "provider",
  async run(d, cfg) {
    const rows = await systemRead(d.db, (tx) =>
      tx.execute<ProviderRow>(sql`
        select s.provider_key, s.status, s.updated_at, s.last_error
        from hub.provider_state s join hub.providers p on p.key = s.provider_key
        where p.enabled and not p.dev_only order by s.provider_key`),
    );
    return evaluateProvider([...rows], d.now, thresholds("provider", cfg).warn ?? 30);
  },
};
