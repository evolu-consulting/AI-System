// CR-193 · BR-193-9 · thẻ «Yêu cầu chờ duyệt»: tối đa 3 dòng (yêu cầu kết nối trước, rồi yêu cầu vào Bảng tin) + «Xem thêm N yêu cầu».
export const PENDING_LIMIT = 3;

export type PendingCut = {
  total: number;
  /** Số dòng «Muốn kết nối» được vẽ. */
  connectShown: number;
  /** Số dòng «Xin vào Bảng tin» được vẽ (Infinity = hết). */
  joinBudget: number;
  /** Số yêu cầu đang bị gập. */
  hidden: number;
  /** Có nút «Xem thêm»/«Thu gọn» không. */
  canToggle: boolean;
};

export function cutPending(
  connect: number,
  join: number,
  expanded: boolean,
  limit = PENDING_LIMIT,
): PendingCut {
  const total = connect + join;
  const canToggle = total > limit;
  if (expanded || !canToggle)
    return {
      total,
      connectShown: connect,
      joinBudget: Number.POSITIVE_INFINITY,
      hidden: 0,
      canToggle,
    };
  const connectShown = Math.min(connect, limit);
  return {
    total,
    connectShown,
    joinBudget: Math.max(0, limit - connectShown),
    hidden: total - limit,
    canToggle,
  };
}
