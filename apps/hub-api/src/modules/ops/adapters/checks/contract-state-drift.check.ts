// CR-127 · Z1 · BR-79 · ops-checks · "Trạng thái hợp đồng lệch" (`contract_state_drift`): bất biến của máy trạng thái 4 trạng thái + lượt duyệt, để dữ liệu
// lệch tự lộ ra thay vì người dùng gặp. Năm nhóm lệch (đếm toàn hệ thống, một câu SQL tập hợp — Luật 4c):
//  1. processing_no_run  — HĐ `processing` quá 10 phút mà không có lượt duyệt đang mở (`run_id` → `approvals` level1/level2/extracting);
//  2. closed_with_run    — HĐ `done`/`reject` mà vẫn trỏ lượt đang mở;
//  3. effect_drift       — `effect` ≠ tính lại (`effect_of` với hôm nay ±1 ngày vì múi giờ công ty) hoặc HĐ `done` (bản hiện hành) chưa có `effect`;
//  4. over_plan          — tổng mốc thanh toán còn hiệu lực vượt giá trị HĐ (>105%, mốc làm thiếu sinh con phải giữ tổng);
//  5. request_no_event   — yêu cầu thực hiện `pending` quá 10 phút mà chưa có sự kiện quy trình (`flow_event_id` trống ⇒ không ai được giao duyệt).
// Đọc chéo công ty qua hàm SECURITY DEFINER `contracts.state_drift_counts()` (MIGC 0099; `contracts_job` chỉ có EXECUTE, không đọc bảng).
import { sql } from "drizzle-orm";
import { withPackJobRoleInTx } from "../../../packs/kit/public";
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import { systemRead } from "./check-kit";

export type ContractDriftAgg = {
  processing_no_run: number;
  closed_with_run: number;
  effect_drift: number;
  over_plan: number;
  request_no_event: number;
};

/** Mỗi nhóm: nhãn người dùng đọc được + mức (crit = trạng thái/hiệu lực lệch; warn = số liệu/yêu cầu lệch). */
const GROUPS: readonly { key: keyof ContractDriftAgg; label: string; crit: boolean }[] = [
  { key: "processing_no_run", label: "HĐ đang xử lý nhưng không có lượt duyệt mở", crit: true },
  { key: "closed_with_run", label: "HĐ đã chốt (hiệu lực/từ chối) còn lượt duyệt mở", crit: true },
  { key: "effect_drift", label: "hiệu lực HĐ khác kết quả tính lại", crit: true },
  { key: "over_plan", label: "HĐ có mốc thanh toán vượt giá trị hợp đồng", crit: false },
  {
    key: "request_no_event",
    label: "yêu cầu thực hiện chờ duyệt chưa có sự kiện quy trình",
    crit: false,
  },
];

const HINT =
  "Mở HĐ lệch (Sổ Hợp Tác) kiểm lượt duyệt/mốc; HĐ processing mất lượt: Rút về rồi Gửi lại; hiệu lực lệch: vòng hiệu lực hằng ngày tự tính lại, nếu còn lệch báo kỹ thuật.";

/** Thuần. 0 ⇒ ok; có nhóm crit ⇒ crit; còn lại ⇒ warn. */
export function evaluateContractDrift(a: ContractDriftAgg): OpsCheckResult {
  const hit = GROUPS.filter((g) => a[g.key] > 0);
  if (hit.length === 0)
    return {
      status: "ok",
      value: { ...a },
      message: "Trạng thái hợp đồng, lượt duyệt và hiệu lực khớp nhau",
    };
  return {
    status: hit.some((g) => g.crit) ? "crit" : "warn",
    value: { ...a },
    message: hit.map((g) => `${a[g.key]} ${g.label}`).join("; "),
    hint: HINT,
  };
}

/** Một câu, văn bản cố định: hàm DEFINER `contracts.state_drift_counts()` (MIGC 0099) — không cấp quyền đọc bảng cho role quét. */
export const contractDriftQuery = () => sql`select * from contracts.state_drift_counts()`;

export const contractStateDriftCheck: OpsCheck = {
  key: "contract_state_drift",
  async run(d) {
    const rows = await systemRead(d.db, (tx) =>
      withPackJobRoleInTx(tx, "contracts", () =>
        tx.execute<ContractDriftAgg>(contractDriftQuery()),
      ),
    );
    const r = rows[0];
    return evaluateContractDrift({
      processing_no_run: Number(r?.processing_no_run ?? 0),
      closed_with_run: Number(r?.closed_with_run ?? 0),
      effect_drift: Number(r?.effect_drift ?? 0),
      over_plan: Number(r?.over_plan ?? 0),
      request_no_event: Number(r?.request_no_event ?? 0),
    });
  },
};
