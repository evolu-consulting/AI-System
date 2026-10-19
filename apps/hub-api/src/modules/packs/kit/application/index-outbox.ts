// PK-FR-08 · PK-NFR-03 · ADR-0016 §2 · N1 plan §8: cổng outbox chỉ mục của bộ khung gói. Repo dựng TRONG tx của `PackUow`
// (cùng tx với lệnh ghi nghiệp vụ) ⇒ tx rollback thì không còn hàng outbox. Một câu INSERT cố định mỗi lệnh ghi (lô qua một
// tham số JSON), lô rỗng ⇒ 0 câu. Chưa nạp OpenSearch/NOTIFY ở N1 (worker N4).
// Lớp 2 — chỉ kiểu; `IndexOutboxRow` khai lại (luật `ca-application-inward-only` cấm import contract), adapter ép trùng kiểu
// với `@ai/contracts` lúc biên dịch.

export type IndexOutboxOp = "upsert" | "delete";

/** Một thay đổi cần đánh chỉ mục: `entity` khớp `^[a-z][a-z0-9_]{1,40}$` (CHECK ở DB), `entity_id` uuid. */
export type IndexOutboxRow = { entity: string; entity_id: string; op: IndexOutboxOp };

export type IndexOutbox = {
  /** Một câu INSERT cho cả lô (tenant lấy từ tx); rỗng ⇒ không chạy câu nào. */
  enqueue(rows: readonly IndexOutboxRow[]): Promise<void>;
};

/** Repo bộ khung mọi gói có trong tx (gói ghép vào repo riêng của mình). */
export type KitTxRepos = { outbox: IndexOutbox };
