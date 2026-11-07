// CR-123 · p25 · FLOW3-FR-06 · lịch sử hoàn tác / làm lại của một phiên sửa (RAM, không lưu): tối đa 100 bước, thuần.
// Sửa liên tiếp CÙNG một ô (cùng `key`) trong `COALESCE_MS` gộp thành một bước — gõ một câu không chiếm 100 bước.
export const HISTORY_MAX = 100;
export const COALESCE_MS = 1000;

export type History<T> = {
  past: readonly T[];
  future: readonly T[];
  /** Khoá và thời điểm của lần ghi gần nhất (để gộp). */
  key: string | null;
  at: number;
};

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], key: null, at: 0 });

/** Ghi lại trạng thái TRƯỚC khi đổi. `key` vắng ⇒ luôn là một bước riêng. Ghi mới xoá nhánh "làm lại". */
export function record<T>(
  h: History<T>,
  prev: T,
  key: string | undefined,
  now: number,
): History<T> {
  const merge = key !== undefined && h.key === key && now - h.at < COALESCE_MS && h.past.length > 0;
  const past = merge ? h.past : [...h.past, prev].slice(-HISTORY_MAX);
  return { past, future: [], key: key ?? null, at: now };
}

/** Lùi một bước: trả lịch sử mới + trạng thái cần áp (`cur` đi vào "làm lại"); hết lịch sử ⇒ `null`. */
export function undo<T>(h: History<T>, cur: T): { h: History<T>; value: T } | null {
  const value = h.past[h.past.length - 1];
  if (h.past.length === 0) return null;
  return {
    h: { past: h.past.slice(0, -1), future: [...h.future, cur], key: null, at: 0 },
    value: value as T,
  };
}

export function redo<T>(h: History<T>, cur: T): { h: History<T>; value: T } | null {
  const value = h.future[h.future.length - 1];
  if (h.future.length === 0) return null;
  return {
    h: {
      past: [...h.past, cur].slice(-HISTORY_MAX),
      future: h.future.slice(0, -1),
      key: null,
      at: 0,
    },
    value: value as T,
  };
}
