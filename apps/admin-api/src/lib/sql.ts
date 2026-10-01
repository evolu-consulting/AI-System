// ADM-FR-04, ADM-FR-60 · helper SQL dùng chung cho list.

/** `%q%` cho ILIKE; ký tự đại diện `\ % _` trong `q` được thoát để tìm đúng chuỗi người dùng gõ. */
export const likeArg = (q: string): string => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
