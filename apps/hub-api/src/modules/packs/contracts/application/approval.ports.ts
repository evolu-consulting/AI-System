// HD-FR-31…37 · HD3 plan §2: cổng của flow duyệt hợp đồng (lớp 2 — chỉ kiểu). Repo chạy trong tx `PackUow` (role `contracts_rw`,
// RLS tenant); mỗi hàm MỘT câu. Mọi ghi do tool/flow có điều kiện `run_id = $run` (D3-03) + trạng thái (idempotent, D3-09).
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { PackUow } from "../../kit/application/ports";
import type { ApprovalSettings } from "../domain/approval-def.rules";

export type ContractRunRef = {
  runId: string | null;
  status: string;
  hasSource: boolean;
  version: number;
};
export type BeginExtract = "extract" | "skip" | "denied";

export type ApprovalRepo = {
  /** HĐ của tenant: run đang gắn + trạng thái; không có ⇒ null. */
  runOf(id: string): Promise<ContractRunRef | null>;
  /** Gắn run mới khi HĐ chưa có run hoặc vẫn giữ `prev` (run cũ đã kết thúc); false ⇒ bị chiếm (đua). */
  attachRun(id: string, runId: string, prev: string | null, actor: string): Promise<boolean>;
  /** Tool `contracts-extract`: HĐ của run ở `extracting`/`extract_failed` có nguồn ⇒ `extracting` ⇒ "extract"; còn lại (nhập tay, mở lại duyệt sau sửa) ⇒ "skip". */
  beginExtract(id: string, runId: string): Promise<BeginExtract>;
  /** Redo cấp 1: `on` ⇒ `needs_review → extracting`; `!on` ⇒ hoàn tác (engine từ chối). */
  markExtracting(id: string, runId: string, on: boolean): Promise<boolean>;
  /** `fields.total_value.value` hiện tại của HĐ thuộc run; không thuộc ⇒ undefined. */
  valueOf(id: string, runId: string): Promise<number | null | undefined>;
  /** `needs_review → active` + `confirmed_*` + event `approved` (chỉ HĐ của run). */
  finalize(id: string, runId: string, by: string | null): Promise<boolean>;
  /** Run kết thúc không Đạt ⇒ `rejected` + event (`rejected`/`cancelled`) — chỉ khi HĐ còn giữ run và chưa kết thúc. */
  markRejected(
    id: string,
    runId: string,
    e: { kind: "rejected" | "cancelled"; feedback: string | null; actor: string | null },
  ): Promise<boolean>;
  settings(): Promise<ApprovalSettings>;
  saveSettings(s: ApprovalSettings, actor: string): Promise<ApprovalSettings>;
};

/** Vòng quét (scope `system` từng tenant): HĐ đang trong flow + đóng lô theo JSON. */
export type FlowRow = {
  id: string;
  runId: string | null;
  status: string;
  stale: boolean;
  /** ISO — con trỏ quét. */
  updatedAt: string;
};
export type FlowCursor = { at: string; id: string };
export type SweepRepo = {
  /** HĐ `extracting`/`extract_failed`/`needs_review` có run, hoặc `extracting` không run quá hạn (≤ `limit`). */
  inFlow(staleMinutes: number, limit: number, after: FlowCursor | null): Promise<FlowRow[]>;
  /** MỘT câu theo lô JSON: `rejected`/`cancelled` ⇒ `rejected` + event; `stale` ⇒ `extract_failed STALE`. */
  close(
    rows: readonly {
      id: string;
      runId: string | null;
      action: "rejected" | "cancelled" | "stale" | "failed";
      feedback: string | null;
    }[],
  ): Promise<number>;
};

export type ApprovalTxRepos = { approval: ApprovalRepo } & KitTxRepos;
export type ApprovalUow = PackUow<ApprovalTxRepos>;
