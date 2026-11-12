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
 * Đọc dữ kiện HIỆN TẠI của bản ghi cho node Nếu (FLOW2-FR-12/21). Tối đa MỘT câu SQL mỗi nguồn dữ liệu (Luật 4c). Bản ghi không thấy
 * trong tenant ⇒ `null` (không lộ tồn tại).
 * BẢO MẬT: engine gọi reader NGOÀI tx của join bước và ngoài RLS của người dùng ⇒ reader PHẢI tự lọc `tenant_id = tenantId` ở mọi
 * câu (không tin `ref` một mình) và chỉ đọc dữ liệu ĐÃ COMMIT (kết nối/scope riêng của gói, không dùng tx của engine).
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
  /**
   * CR-122 · P11 · lượt vừa được bộ điều phối mở cho sự kiện của bản ghi — gọi TRONG tx tạo run (cùng commit): app gắn run vào bản
   * ghi (vd thẻ duyệt HĐ). Phải idempotent + có điều kiện (CAS). P11c · trả false = bản ghi KHÔNG nhận lượt này (đã có run khác / đã
   * quyết) ⇒ tx tạo run ROLLBACK, sự kiện chốt `superseded`; sự kiện không cần gắn ⇒ trả true. Ném ⇒ tx rollback, sự kiện thử lại.
   */
  launched?(tx: TX, input: Omit<OutcomeInput, "outcome" | "actorId">): Promise<boolean>;
  /**
   * CR-122 · P11b · sự kiện của bản ghi đã chốt mà KHÔNG mở được lượt nào (0 flow khớp / từ chối / hết lượt thử) — gọi TRONG tx chốt
   * lô của bộ điều phối. `reason` = mã máy (vd `FLOW_NOT_ASSIGNED`, `FLOW_GROUP_MISSING:<mã>`). Có điều kiện (CAS), không ném.
   */
  notLaunched?(
    tx: TX,
    input: { tenantId: string; event: string; ref: string; reason: string },
  ): Promise<boolean>;
  /**
   * CR-127 K3 · spec §3 #7b · lượt bị HUỶ (Dừng / Rút về) — gọi TRONG tx dừng lượt (`RunControlService.stop`, sau `cancelEnd`). CAS theo
   * `runId` (lượt đã đổi / bản ghi đã rời trạng thái ⇒ false, KHÔNG ném). Ném ⇒ chỉ log (engine không rollback lệnh dừng).
   */
  cancelled?(tx: TX, input: FlowRunEnd): Promise<boolean>;
  /** CR-127 K3 · lượt LỖI (settle tổng hợp `failed`) — như `cancelled`, gọi trong tx settle. */
  failed?(tx: TX, input: FlowRunEnd): Promise<boolean>;
  /**
   * CR-127 K3 · #76 · lượt HẾT HẠN theo lô (tx `system` nhiều tenant của `expireBatch`) — gọi MỘT lần mỗi lô với mọi lượt của handler này;
   * app làm theo tập (số câu cố định). Trả số bản ghi đã đổi. Ném ⇒ chỉ log.
   */
  failedBatch?(tx: TX, items: readonly FlowRunEnd[]): Promise<number>;
};

/** Lượt kết thúc không thành công (huỷ / lỗi / hết hạn). `reason` = mã hoặc câu ngắn (≤ 200 ký tự). */
export type FlowRunEnd = {
  tenantId: string;
  event: string;
  ref: string;
  runId: string;
  reason: string;
};

/** CR-127 K3 · "có quy trình khớp?" — cùng luật `match.rules` + `company_flows` đang bật của bộ điều phối (spec §3). */
export type FlowAvailability<TX = unknown> = {
  hasFlowFor(
    tx: TX,
    q: { tenantId: string; app: string; event: string; facts: FlowFacts },
  ): Promise<boolean>;
  /**
   * CR-127 · M4 · các bước SẼ đi qua nếu sự kiện xảy ra bây giờ (CÙNG chọn quy trình với `hasFlowFor`; đi đường "Duyệt hết" theo dữ kiện
   * hiện tại bằng luật thuần của Chạy thử). Không quy trình khớp ⇒ null. Chỉ đọc; số câu SQL cố định. Vắng ⇒ gói coi như không xem trước được.
   */
  outline?(
    q: { tenantId: string; app: string; event: string; facts: FlowFacts },
    o: { starterId: string },
  ): Promise<FlowOutline | null>;
};

/** CR-127 · M4 · kết quả `outline` (cùng hình dạng với `SubmitPreviewResponse` không có `block`). */
export type FlowOutline = {
  flowName: string;
  steps: readonly {
    kind: "review" | "esign" | "partner_send" | "notify" | "milestone" | "step";
    label: string;
    whoLabel: string;
    dueH?: number;
  }[];
};

/** CR-127 K3 · bước hiện tại của lượt: đã có quyết định/phiếu chưa (chặn Rút về) + ai đang giữ việc (được báo khi rút — R#26). */
export type FlowRunStep = {
  open: boolean;
  decided: { by: string | null; stageIdx: number } | null;
  claimers: string[];
};
/** CR-127 K3 · lệnh huỷ lượt (Rút về): huỷ như "Dừng" (`RunControlService.stop`, hook `cancelled` cùng tx) + báo người đã nhận việc. */
export type FlowRunControl = {
  inspect(q: { tenantId: string; runId: string }): Promise<FlowRunStep | null>;
  cancel(q: {
    tenantId: string;
    runId: string;
    actorId: string;
    reason: string;
    notify: readonly string[];
  }): Promise<boolean>;
};
/** CR-127 E6 · một bản ghi tới mốc lịch: `dueKey` = mốc ngày (vd ngày hết hạn / hạn mốc, `YYYY-MM-DD`) — vào khoá idempotent. */
export type ScheduledDue = {
  ref: string;
  /** Dữ kiện lúc tới mốc (KHÔNG gồm `days` — engine đặt `days = N` của quy trình). */
  facts: FlowFacts;
  dueKey: string;
  /** Người bắt đầu lượt (vd người phụ trách HĐ); null ⇒ bộ điều phối không mở lượt (`no_actor`). */
  actorId: string | null;
};
export type ScheduledQuery = {
  tenantId: string;
  event: string;
  params: { days: number };
  /** Ngày hôm nay theo múi giờ công ty, `YYYY-MM-DD`. */
  today: string;
  limit: number;
  /** Trang theo khoá: bản ghi sắp tăng theo `(dueKey, ref)`; chỉ lấy bản sau `after` (bản cuối của trang trước). */
  after: { dueKey: string; ref: string } | null;
};
/**
 * CR-127 E6 · spec §5.5 · nguồn của sự kiện THEO LỊCH (`AppEventDecl.schedule`): bản ghi tới mốc N ngày. MỘT câu SQL theo tập mỗi trang,
 * tự lọc `tenant_id`, loại bản đã thay thế. Engine (`schedule-sweep`) phát `flow_events` idempotent theo (sự kiện, ref, dueKey, N).
 */
export type ScheduledSource = {
  packKey: string;
  events: readonly string[];
  dueRecords(q: ScheduledQuery): Promise<ScheduledDue[]>;
};

/** Cổng engine cho gói (processes đăng ký lúc mount; gói không import `processes`). */
export type FlowEngine = { runControl: FlowRunControl; availability: FlowAvailability };
