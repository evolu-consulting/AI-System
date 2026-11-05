// CR-121 R-5 · phần phụ trợ của `captureSql` (hd1.ts): lọc câu nền của Hub + khẳng định số câu kèm văn bản câu.
import type { Cap } from "./hd1";

/**
 * Câu NỀN của Hub (cùng tiến trình, chung pool với đường đo) mà `captureSql` không đếm: chỉ đúng các mẫu dưới đây, mỗi mẫu có lý do.
 * Bắt được ở W1/mywork (wave nặng): các vòng nền của Hub lọt vào cửa sổ đo; không đường nào của gói contracts đọc/ghi các bảng này.
 */
export const BACKGROUND: readonly { re: RegExp; why: string }[] = [
  {
    re: /^\s*select\s+"id",\s+"tenant_id",\s+"user_id",\s+"conversation_id",\s+"flow_id",\s+"answer_message_id",\s+"locale",\s+"room_id"\s+from\s+"hub"\."runs"/i,
    why: "vòng nền chạy lượt của Hub (runs.repo) đọc hub.runs — không thuộc đường đo của gói",
  },
  {
    re: /^\s*UPDATE\s+hub\.jobs\s+SET\s+status\s+=\s+'(queued|failed)'/i,
    why: "vòng nền dọn job mồ côi / hết hạn của Hub (job-orphan-sweep) — ghi hub.jobs",
  },
  {
    re: /^\s*select\s+r\.id\s+from\s+hub\.runs\s+r\s+where\s+r\.room_id\s+is\s+not\s+null\s+and\s+r\.room_posted_at\s+is\s+null/i,
    why: "vòng nền đối soát tin phòng của lượt chạy (room-post-reconcile) — đọc hub.runs",
  },
];

/** Văn bản các câu đã chụp (gọn, để assert in ra câu thừa khi số câu lệch). */
export const queryTexts = (queries: readonly Cap[]): string[] =>
  queries.map((q, i) => `${i + 1}. ${q.text.replace(/\s+/g, " ").slice(0, 140)}`);

/** Khẳng định số câu SQL từng lượt chụp (`captureSql`) khớp `expected`; lệch ⇒ báo lỗi KÈM văn bản mọi câu của các lượt để thấy ngay câu thừa. */
export function expectQueryCounts(
  caps: readonly { queries: readonly Cap[] }[],
  expected: readonly number[],
): void {
  const got = caps.map((c) => c.queries.length);
  if (got.length === expected.length && got.every((n, i) => n === expected[i])) return;
  const dump = caps.map(
    (c, i) => `#${i} (${c.queries.length} câu):\n  ${queryTexts(c.queries).join("\n  ")}`,
  );
  throw new Error(
    `số câu SQL lệch: nhận ${JSON.stringify(got)}, mong ${JSON.stringify(expected)}\n${dump.join("\n")}`,
  );
}
