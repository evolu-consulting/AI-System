// CR-117 · ops-watch · luật thuần của check `slo`: định nghĩa SLO, trạng thái qua các lượt kiểm (chuỗi vi phạm liên tiếp + lịch sử
// cho tốc độ đốt ngân sách), phán quyết warn/crit. Không I/O. Trạng thái nằm trong `value` của check (đọc lại qua `prev`).
import type { OpsStatus } from "@ai/contracts/hub-admin";

export type SloUnit = "ms" | "s" | "pct";
export type SloDef = {
  id: string;
  label: string;
  unit: SloUnit;
  /** Vi phạm khi giá trị đo > `limit`. */
  limit: number;
  /** Tỷ lệ lượt kiểm phải đạt trong cửa sổ lịch sử (ngân sách lỗi = 1 − target). */
  target: number;
};

export const SLO_DEFS: readonly SloDef[] = [
  { id: "contracts_list_p95", label: "contracts.list p95", unit: "ms", limit: 700, target: 0.95 },
  { id: "chat_dispatch_p50", label: "chat dispatch p50", unit: "ms", limit: 1000, target: 0.95 },
  { id: "timer_lag_p95", label: "timer PD-P01 trễ p95", unit: "s", limit: 120, target: 0.95 },
  { id: "log_error_rate", label: "tỷ lệ lỗi log", unit: "pct", limit: 1, target: 0.95 },
];

/** 48 lượt ≈ 24 giờ ở nhịp 30 phút. */
export const HIST_MAX = 48;
export const BURN_MIN_SAMPLES = 6;
/** Đốt ngân sách nhanh ≥ N lần mức cho phép (và đủ mẫu) ⇒ warn dù chưa đủ chuỗi liên tiếp. */
export const BURN_WARN = 6;

/** Trạng thái một SLO sau lượt kiểm. `v` null = lượt này không có số đo. `hist`: '0' tốt / '1' vi phạm, mới nhất cuối. */
export type SloState = { id: string; v: number | null; streak: number; hist: string };

export const isBreach = (d: SloDef, v: number): boolean => v > d.limit;

/** Không có số đo ⇒ giữ nguyên chuỗi/lịch sử (lượt không tính); có ⇒ cập nhật chuỗi liên tiếp + lịch sử cắt `HIST_MAX`. */
export function nextState(d: SloDef, prev: SloState | undefined, v: number | null): SloState {
  const streak = prev?.streak ?? 0;
  const hist = prev?.hist ?? "";
  if (v === null) return { id: d.id, v: null, streak, hist };
  const bad = isBreach(d, v);
  return {
    id: d.id,
    v,
    streak: bad ? streak + 1 : 0,
    hist: `${hist}${bad ? "1" : "0"}`.slice(-HIST_MAX),
  };
}

/** Tốc độ đốt ngân sách = (tỷ lệ lượt vi phạm) / (1 − target); null khi chưa đủ mẫu. 1.0 = đốt đúng mức cho phép. */
export function burnRate(hist: string, target: number): number | null {
  if (hist.length < BURN_MIN_SAMPLES) return null;
  const bad = [...hist].filter((c) => c === "1").length;
  return bad / hist.length / (1 - target);
}

function stateStatus(s: SloState, d: SloDef, warnN: number, critN: number): OpsStatus {
  if (s.streak >= critN) return "crit";
  if (s.streak >= warnN) return "warn";
  const burn = burnRate(s.hist, d.target);
  return burn !== null && burn >= BURN_WARN ? "warn" : "ok";
}

const RANK: Record<OpsStatus, number> = { ok: 0, unknown: 0, warn: 1, crit: 2 };

/** Xấu nhất của các SLO; không SLO nào có số đo (mọi lượt đều thiếu dữ liệu) ⇒ `unknown`. */
export function judge(
  states: readonly SloState[],
  defs: readonly SloDef[],
  warnN: number,
  critN: number,
): OpsStatus {
  let worst: OpsStatus = "ok";
  let measured = false;
  for (const s of states) {
    const d = defs.find((x) => x.id === s.id);
    if (!d) continue;
    if (s.hist.length > 0) measured = true;
    const st = stateStatus(s, d, warnN, critN);
    if (RANK[st] > RANK[worst]) worst = st;
  }
  return measured ? worst : "unknown";
}

const fmt = (d: SloDef, v: number): string =>
  `${Number.isInteger(v) ? v : Math.round(v * 100) / 100}${d.unit === "pct" ? "%" : d.unit}`;

/** Thông điệp: các SLO đang vi phạm/đốt nhanh; ổn ⇒ liệt kê số đo; chưa đo gì ⇒ nói rõ. */
export function summarize(
  states: readonly SloState[],
  defs: readonly SloDef[],
  warnN: number,
): string {
  const parts: string[] = [];
  const bad: string[] = [];
  for (const s of states) {
    const d = defs.find((x) => x.id === s.id);
    if (!d) continue;
    if (s.v !== null) parts.push(`${d.label} ${fmt(d, s.v)}`);
    const burn = burnRate(s.hist, d.target);
    if (s.streak >= warnN || (burn !== null && burn >= BURN_WARN))
      bad.push(
        `${d.label} vượt ${fmt(d, d.limit)} ${s.streak} lượt liên tiếp${burn === null ? "" : `, đốt ngân sách ${Math.round(burn * 10) / 10}x`}`,
      );
  }
  if (bad.length > 0) return bad.join("; ");
  return parts.length > 0 ? `Trong mục tiêu: ${parts.join(", ")}` : "Chưa có số đo SLO nào";
}

/** Đọc lại trạng thái từ `value` của lượt trước (sai dạng ⇒ bỏ qua mục đó). */
export function parseStates(value: unknown): Map<string, SloState> {
  const out = new Map<string, SloState>();
  const list = (value as { slos?: unknown } | null | undefined)?.slos;
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    const s = raw as Partial<SloState> | null;
    if (!s || typeof s.id !== "string" || typeof s.hist !== "string") continue;
    const streak =
      Number.isInteger(s.streak) && (s.streak as number) >= 0 ? (s.streak as number) : 0;
    out.set(s.id, {
      id: s.id,
      v: typeof s.v === "number" ? s.v : null,
      streak,
      hist: s.hist.replace(/[^01]/g, "").slice(-HIST_MAX),
    });
  }
  return out;
}
