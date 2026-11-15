// CR-151 · một trang danh sách người duyệt: kéo limit+1 dòng (MỘT câu SQL) để biết còn trang sau; `nextOffset` null ⇒ hết.
export type FlowPage = { limit: number; offset: number };
export const cutPage = <T>(rows: T[], p: FlowPage): { rows: T[]; nextOffset: number | null } =>
  rows.length > p.limit
    ? { rows: rows.slice(0, p.limit), nextOffset: p.offset + p.limit }
    : { rows, nextOffset: null };
