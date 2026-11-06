// CR-122 · ADR-0038 · FLOW2-FR-12/15/19/21 · flow-model.md mục C–D: cổng giữa engine flow (`processes/*`) và app (gói). Lớp 2 — chỉ
// kiểu (không I/O). App mới = manifest `events[]` + `FactsReader` + `OutcomeHandler` (+ ghi `FlowEventInput` cùng tx bản ghi).
// Thay dần `FlowSlotAdapter`/`SlotSpec` (giữ tới R1).

/** Giá trị một dữ kiện (khớp `AppFactType`): `department` = mã Group (kể cả phòng cha); `null` = chưa có dữ liệu. */
export type FlowFactValue = string | number | boolean | readonly string[] | null;
/** Dữ kiện theo khoá `AppFactDecl.key`. Khoá vắng ≡ `null` (node Nếu đi nhánh Sai, lịch sử "chưa có dữ liệu"). */
export type FlowFacts = Readonly<Record<string, FlowFactValue>>;

/**
 * Sự kiện app ghi vào hàng đợi (`hub.flow_events`, lát E1) CÙNG transaction với thay đổi bản ghi. `eventId` duy nhất theo tenant
 * (khoá idempotent `(tenant_id, event_id)`, vd `contract.submitted:<id>:<lần gửi>`) — ghi lại ⇒ không mở lượt thứ hai.
 */
export type FlowEventInput = {
  tenantId: string;
  /** `AppEventDecl.key`, vd `contract.submitted`. */
  event: string;
  /** Id bản ghi của app (HĐ, bài, đơn…) — lượt chạy gắn `ref` này. */
  ref: string;
  eventId: string;
  /** Dữ kiện LÚC sự kiện (điều kiện Bắt đầu khi + hiển thị); node Nếu đọc lại giá trị HIỆN TẠI qua `FactsReader`. */
  facts: FlowFacts;
  /** Người gây sự kiện; null = hệ thống. */
  actorId: string | null;
};

/**
 * Đọc dữ kiện HIỆN TẠI của bản ghi cho node Nếu (FLOW2-FR-12/21). Tối đa MỘT câu SQL mỗi nguồn dữ liệu, `tenant_id` tường minh
 * (Luật 4c; E2 đếm câu trong test). Bản ghi không thấy trong tenant ⇒ `null` (không lộ tồn tại).
 */
export type FactsReader = {
  packKey: string;
  /** Sự kiện của app mà reader này phục vụ (⊆ `AppManifest.events`). */
  events: readonly string[];
  read(tenantId: string, ref: string, keys: readonly string[]): Promise<FlowFacts | null>;
};

export type OutcomeInput = {
  tenantId: string;
  runId: string;
  event: string;
  ref: string;
  /** `AppOutcomeDecl.key` của node Kết thúc đã tới, vd `approved` | `rejected` | `returned`. */
  outcome: string;
  /** Người quyết bước cuối; null = hệ thống. */
  actorId: string | null;
};
/** `already_applied` khi gọi lại cùng `(runId, outcome)` — handler PHẢI idempotent (settle chạy lại sau lỗi). */
export type OutcomeResult = "applied" | "already_applied" | "not_found";

/**
 * Việc app làm khi lượt tới node Kết thúc (FLOW2-FR-15: khoá HĐ + gắn SP / Từ chối / Trả lại về Nháp…), gọi TRONG tx settle của
 * engine (`apply-settle.ts`, lát E2) ⇒ kết quả bản ghi và trạng thái lượt cùng commit. `TX` = handle tx engine truyền (E2 chốt kiểu
 * cụ thể; kit không phụ thuộc `@ai/db`). Ném ⇒ settle rollback, engine thử lại theo timer.
 */
export type OutcomeHandler<TX = unknown> = {
  packKey: string;
  events: readonly string[];
  apply(tx: TX, input: OutcomeInput): Promise<OutcomeResult>;
};
