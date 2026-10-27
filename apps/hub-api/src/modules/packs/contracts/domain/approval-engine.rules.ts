// contract-flow S3a · luật thuần (lớp 1) cho duyệt HĐ chạy trên engine: ánh xạ bước engine ↔ bước người dùng, stage ↔ bước,
// kiểm "Đã duyệt" (`finalizeAllowed`: mọi bước bắt buộc theo giá trị HIỆN TẠI đã Đạt) và `finalizesOnApprove` (bước mở là bước
// review áp dụng cuối). Đánh số theo S2: bước người dùng 0 ⇒ engine 0, `route` ⇒ 1, i ≥ 1 ⇒ i + 1, `finalize` ⇒ n + 1.
import {
  FINALIZE_STAGE,
  type FlowFacts,
  type FlowStep,
  ROUTE_STAGE,
  requiredSteps,
  stageKeyOf,
  stepApplies,
} from "./approval-flow.rules";
import type { FlowDeal } from "./approval-flow.types";

/** Vị trí engine ⇒ ý nghĩa với gói (n = số bước người dùng). */
export type EnginePos =
  | { kind: "user"; step: number }
  | { kind: "route" }
  | { kind: "finalize" }
  | { kind: "unknown" };

export function userStepOfEngine(engineStep: number, n: number): EnginePos {
  if (!Number.isInteger(engineStep) || engineStep < 0) return { kind: "unknown" };
  if (engineStep === 0) return { kind: "user", step: 0 };
  if (engineStep === 1) return { kind: "route" };
  if (engineStep === n + 1) return { kind: "finalize" };
  if (engineStep <= n) return { kind: "user", step: engineStep - 1 };
  return { kind: "unknown" };
}

const STAGE_RE = /^s(\d)$/;
/** Khoá stage ⇒ vị trí (`s<i>` ⇒ bước người dùng i; `route`/`finalize`; khác ⇒ unknown). */
export function posOfStage(key: string, n: number): EnginePos {
  if (key === ROUTE_STAGE) return { kind: "route" };
  if (key === FINALIZE_STAGE) return { kind: "finalize" };
  const m = STAGE_RE.exec(key);
  const i = m ? Number(m[1]) : -1;
  return i >= 0 && i < n && key === stageKeyOf(i) ? { kind: "user", step: i } : { kind: "unknown" };
}

/** Khoá stage engine đã Đạt (`passedStages`) ⇒ chỉ số bước người dùng đã Đạt (bỏ trùng, bỏ stage lạ). */
export function passedUserSteps(stageKeys: readonly string[], n: number): number[] {
  const out = new Set<number>();
  for (const k of stageKeys) {
    const p = posOfStage(k, n);
    if (p.kind === "user") out.add(p.step);
  }
  return [...out].sort((a, b) => a - b);
}

/** "Đã duyệt" chỉ khi MỌI bước bắt buộc (theo giá trị hiện tại) đều đã Đạt. */
export const finalizeAllowed = (required: readonly number[], passed: readonly number[]): boolean =>
  required.every((i) => passed.includes(i));

/** Đạt bước mở `open` sẽ ghi "Đã duyệt" khi không còn bước review nào áp dụng sau nó (bước Dify sau đó tự chạy). */
export function finalizesOnApprove(
  steps: readonly FlowStep[],
  f: FlowFacts,
  open: number,
): boolean {
  if (!Number.isInteger(open) || open < 0 || open >= steps.length) return false;
  if (steps[open]?.kind !== "review") return false;
  return steps.slice(open + 1).every((s) => s.kind !== "review" || !stepApplies(s, f));
}

/** `contracts-finalize`: mọi bước REVIEW bắt buộc theo giá trị hiện tại (mẫu chụp `steps`) có trong stage đã Đạt của run. Bước
 *  Dify không có quyết duyệt ⇒ không đòi. */
export function finalizeReady(
  steps: readonly FlowStep[],
  f: FlowFacts,
  passedStageKeys: readonly string[],
): boolean {
  if (steps.length === 0) return false;
  const required = requiredSteps(steps, f).filter((i) => steps[i]?.kind === "review");
  return finalizeAllowed(required, passedUserSteps(passedStageKeys, steps.length));
}

/** Tham số `from_step` của `contracts-route` ⇒ bước người dùng hợp lệ (số nguyên 0..n-1); sai ⇒ null. */
export function routeFrom(v: unknown, n: number): number | null {
  const i = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof i === "number" && Number.isInteger(i) && i >= 0 && i < n ? i : null;
}

/** Mở run engine chỉ cho lượt `level1` còn chế độ máy, chưa gắn run. */
/** Feature (admin.features) cấp theo công ty để HĐ của công ty đó duyệt trên engine. */
export const ENGINE_FEATURE_KEY = "contracts-approval-engine";

/** engine-flag-tenant · env `CONTRACTS_APPROVAL_ENGINE`: ≠ `on` (kể cả `off`/vắng) ⇒ tắt hết (công tắc khẩn); `on` ⇒ chỉ tenant
 *  có entitlement `contracts-approval-engine` còn hiệu lực. Lượt đã chạy engine không phụ thuộc hàm này (chạy nốt). */
export const engineAllowedForTenant = (i: {
  env: string | undefined;
  entitled: boolean;
}): boolean => i.env === "on" && i.entitled;

export const engineStartable = (r: {
  approvalStatus: string | null;
  mode: string | null;
  engineRunId: string | null;
}): boolean => r.approvalStatus === "level1" && r.mode === "machine" && r.engineRunId === null;

const DEALS: ReadonlySet<string> = new Set(["buy", "sell", "referral"]);
/** Hàng HĐ ⇒ facts rẽ nhánh (loại lạ ⇒ null = cần bước). */
export const factsOf = (deal: string | null, totalValue: unknown): FlowFacts => ({
  deal: deal !== null && DEALS.has(deal) ? (deal as FlowDeal) : null,
  total_value: totalValue,
});

// ── contract-flow S3b ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Version def engine (`pack_version`, số nguyên tăng): mẫu đã lưu ⇒ `STORED_BASE + version`; mẫu mặc định (dựng từ cài đặt) ⇒
 *  `1 + rev` với `rev` = phút từ 2020-01-01 tới lần lưu cài đặt gần nhất (đổi cài đặt ⇒ ensureDef ghi đè). Mọi mẫu lưu luôn lớn hơn
 *  mọi mẫu mặc định (rev < STORED_BASE tới năm ~2210). */
export const ENGINE_STORED_BASE = 100_000_000;
/** prod-fix2 · dạng def đổi (thêm `also_group_ids`) ⇒ cộng `ENGINE_SHAPE` cho MỌI version để def cũ đã đồng bộ (≤ 100 tr + version)
 *  bị ghi đè ở lần mở duyệt kế; thứ tự mặc định < đã lưu giữ nguyên. Đổi dạng lần sau ⇒ tăng thêm một bậc 200 tr. */
export const ENGINE_SHAPE = 200_000_000;
export const engineDefVersion = (f: { version: number; isDefault: boolean }, rev: number): number =>
  ENGINE_SHAPE + (f.isDefault ? 1 + Math.max(0, Math.trunc(rev)) : ENGINE_STORED_BASE + f.version);

const TERMINAL_RUN: ReadonlySet<string> = new Set(["done", "failed", "cancelled", "expired"]);
export const isTerminalRun = (status: string): boolean => TERMINAL_RUN.has(status);
export type RunOutcomeLite = { status: string; rejected: boolean; feedback: string | null };
export type Reconcile =
  | { kind: "none" }
  | { kind: "reject"; feedback: string | null }
  | { kind: "stalled"; reason: string };

/** Lượt `engine` còn `level1` mà run đã kết thúc ⇒ đồng bộ HĐ: Từ chối ⇒ HĐ rejected; còn lại (huỷ ngoài luồng, lỗi, mất, hết hạn,
 *  xong mà lượt chưa ghi) ⇒ `stalled`: GIỮ chế độ engine (không bao giờ về máy cũ — máy cũ lách head_only/luồng), ghi lý do, chờ
 *  owner/admin "Mở lại quy trình". Run còn chạy ⇒ không làm gì. */
export function reconcileOf(o: RunOutcomeLite | undefined): Reconcile {
  if (!o) return { kind: "stalled", reason: "ENGINE_RUN_MISSING" };
  if (!TERMINAL_RUN.has(o.status)) return { kind: "none" };
  if (o.rejected) return { kind: "reject", feedback: o.feedback };
  return { kind: "stalled", reason: `ENGINE_RUN_${o.status.toUpperCase()}` };
}
