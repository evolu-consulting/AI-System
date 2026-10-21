// my-activity-rag · cổng "nguồn hoạt động" của gói cho tool lõi `my-activity` (lớp 2, chỉ kiểu). Gói cài đặt bằng `PackUow` của
// chính nó (role gói + RLS của NGƯỜI GỌI); lõi gộp với audit Hub/Admin. Mọi hàng đã qua RLS: `mine` chỉ thao tác của chính người
// gọi; `record` chỉ bản ghi người gọi mở được trên giao diện (luật thấy của gói) — kèm lịch sử như trang chi tiết.

export type ActivityWho = { tenantId: string; userId: string };
/** Khoảng ngày theo lịch tenant (`tz`); `action` = mẫu LIKE đã làm sạch hoặc null. */
export type ActivityWindow = {
  from: string | null;
  to: string | null;
  tz: string;
  action: string | null;
  limit: number;
  objects: readonly ("contract" | "partner")[];
};
export type ActivityRow = {
  at: string;
  object: "contract" | "partner";
  action: string;
  actor_id: string | null;
  ref_id: string | null;
  name: string | null;
  number: string | null;
  party: string | null;
  detail?: unknown;
};
export type RecordHistory = {
  id: string;
  title: string;
  number: string | null;
  events: ActivityRow[];
};

export type ActivitySource = {
  /** Gói nguồn — lõi chỉ gọi khi người gọi đọc được gói này. */
  pack: string;
  mine(who: ActivityWho, w: ActivityWindow): Promise<ActivityRow[]>;
  /** Lịch sử bản ghi theo id/số; không thấy ⇒ []. Tối đa 5 bản ghi khớp số. */
  record(
    who: ActivityWho,
    ref: { id: string | null; number: string | null },
    limit: number,
  ): Promise<RecordHistory[]>;
};
